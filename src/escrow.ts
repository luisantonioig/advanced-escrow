import {
  applyParamsToScript,
  BlockfrostProvider,
  type Data,
  type IFetcher,
  MeshTxBuilder,
  pubKeyAddress,
  resolveDataHash,
  resolvePaymentKeyHash,
  resolvePlutusScriptAddress,
  serializeAddressObj,
  type UTxO,
} from "@meshsdk/core";
import blueprint from "../plutus.json" with { type: "json" };

type NetworkId = 0 | 1;

type EscrowAction = "Release" | "Refund" | "ResolveBuyer" | "ResolveSeller";

type EscrowParties = {
  buyer: string;
  seller: string;
  arbiter: string;
  escrowId: string;
};

export type EscrowWallet = {
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getUtxos(): Promise<UTxO[]>;
  getCollateral(): Promise<UTxO[]>;
  signTx(unsignedTx: string, partialSign?: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
};

type RedeemEscrowArgs = {
  wallet: EscrowWallet;
  provider: IFetcher;
  parties: EscrowParties;
  action: EscrowAction;
  networkId?: NetworkId;
};

const redeemerIndex: Record<EscrowAction, number> = {
  Release: 0,
  Refund: 1,
  ResolveBuyer: 2,
  ResolveSeller: 3,
};

export function escrowDatum(parties: EscrowParties): Data {
  return {
    alternative: 0,
    fields: [
      parties.buyer,
      parties.seller,
      parties.arbiter,
      Buffer.from(parties.escrowId, "utf8").toString("hex"),
    ],
  };
}

export function escrowRedeemer(action: EscrowAction): Data {
  return {
    alternative: redeemerIndex[action],
    fields: [],
  };
}

export function getEscrowScript(networkId: NetworkId = 0) {
  const validator = blueprint.validators.find(
    ({ title }) => title === "escrow.escrow.spend",
  );

  if (!validator) {
    throw new Error("Validator escrow.escrow.spend was not found in plutus.json.");
  }

  const code = applyParamsToScript(validator.compiledCode, []);
  const script = { code, version: "V3" as const };
  const address = resolvePlutusScriptAddress(script, networkId);

  return { script, address };
}

export async function walletPaymentKeyHash(wallet: EscrowWallet) {
  const usedAddresses = await wallet.getUsedAddresses();
  const address = usedAddresses[0] ?? (await wallet.getChangeAddress());

  return resolvePaymentKeyHash(address);
}

export async function lockEscrow(args: {
  wallet: EscrowWallet;
  provider: IFetcher;
  parties: EscrowParties;
  lovelace: string;
  networkId?: NetworkId;
}) {
  const { address } = getEscrowScript(args.networkId);
  const datum = escrowDatum(args.parties);
  const utxos = await args.wallet.getUtxos();
  const changeAddress = await args.wallet.getChangeAddress();

  const unsignedTx = await new MeshTxBuilder({ fetcher: args.provider })
    .txOut(address, [{ unit: "lovelace", quantity: args.lovelace }])
    .txOutDatumHashValue(datum)
    .changeAddress(changeAddress)
    .selectUtxosFrom(utxos)
    .complete();

  const signedTx = await args.wallet.signTx(unsignedTx);
  return args.wallet.submitTx(signedTx);
}

export async function redeemEscrow(args: RedeemEscrowArgs) {
  const { script, address } = getEscrowScript(args.networkId);
  const datum = escrowDatum(args.parties);
  const redeemer = escrowRedeemer(args.action);
  const lockedUtxo = await findEscrowUtxo(args.provider, address, datum);
  const walletUtxos = await args.wallet.getUtxos();
  const changeAddress = await args.wallet.getChangeAddress();
  const collateral = await args.wallet.getCollateral();

  if (!collateral?.length) {
    throw new Error("No collateral found. Set collateral in your wallet first.");
  }

  const requiredSigner = signerForAction(args.action, args.parties);
  const payoutAddress = payoutForAction(args);

  const unsignedTx = await new MeshTxBuilder({ fetcher: args.provider })
    .spendingPlutusScriptV3()
    .txIn(lockedUtxo.input.txHash, lockedUtxo.input.outputIndex)
    .txInDatumValue(datum)
    .txInRedeemerValue(redeemer)
    .txInScript(script.code)
    .txOut(payoutAddress, lockedUtxo.output.amount)
    .txOutInlineDatumValue(outputReferenceData(lockedUtxo.input))
    .requiredSignerHash(requiredSigner)
    .txInCollateral(
      collateral[0].input.txHash,
      collateral[0].input.outputIndex,
      collateral[0].output.amount,
      collateral[0].output.address,
    )
    .changeAddress(changeAddress)
    .selectUtxosFrom(walletUtxos)
    .complete();

  const signedTx = await args.wallet.signTx(unsignedTx, true);
  return args.wallet.submitTx(signedTx);
}

export function blockfrostProvider(projectId: string) {
  return new BlockfrostProvider(projectId);
}

async function findEscrowUtxo(provider: IFetcher, address: string, datum: Data) {
  const dataHash = resolveDataHash(datum);
  const utxos = await provider.fetchAddressUTxOs(address, "lovelace");
  const matches = utxos.filter(
    (utxo: UTxO) => utxo.output.dataHash === dataHash,
  );

  if (matches.length === 0) {
    throw new Error(`No escrow UTxO found at ${address} for datum ${dataHash}.`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple escrow UTxOs found at ${address} for datum ${dataHash}.`,
    );
  }

  return matches[0];
}

function signerForAction(action: EscrowAction, parties: EscrowParties) {
  switch (action) {
    case "Release":
      return parties.buyer;
    case "Refund":
      return parties.seller;
    case "ResolveBuyer":
    case "ResolveSeller":
      return parties.arbiter;
  }
}

function payoutForAction(args: RedeemEscrowArgs) {
  const paymentKeyHash = (() => {
    switch (args.action) {
      case "Release":
      case "ResolveSeller":
        return args.parties.seller;
      case "Refund":
      case "ResolveBuyer":
        return args.parties.buyer;
    }
  })();

  return serializeAddressObj(
    pubKeyAddress(paymentKeyHash),
    args.networkId ?? 0,
  );
}

function outputReferenceData(input: UTxO["input"]): Data {
  return {
    alternative: 0,
    fields: [input.txHash, input.outputIndex],
  };
}
