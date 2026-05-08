import "dotenv/config";
import { MeshWallet } from "@meshsdk/wallet";
import {
  blockfrostProvider,
  getEscrowScript,
  lockEscrow,
  redeemEscrow,
  walletPaymentKeyHash,
} from "./escrow.js";

type Role = "buyer" | "seller" | "arbiter";

const roles: Role[] = ["buyer", "seller", "arbiter"];

const actionWallet: Record<string, Role> = {
  release: "buyer",
  refund: "seller",
  "resolve-buyer": "arbiter",
  "resolve-seller": "arbiter",
};

const actionName = {
  release: "Release",
  refund: "Refund",
  "resolve-buyer": "ResolveBuyer",
  "resolve-seller": "ResolveSeller",
} as const;

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (command === "generate-wallet") {
    console.log((MeshWallet.brew(false, 256) as string[]).join(" "));
    return;
  }

  const provider = blockfrostProvider(requiredEnv("BLOCKFROST_PROJECT_ID"));
  const networkId = network();
  const wallets = {
    buyer: await walletFromEnv("BUYER_MNEMONIC", provider, networkId),
    seller: await walletFromEnv("SELLER_MNEMONIC", provider, networkId),
    arbiter: await walletFromEnv("ARBITER_MNEMONIC", provider, networkId),
  };

  if (command === "script-address") {
    console.log(getEscrowScript(networkId).address);
    return;
  }

  if (command === "addresses") {
    for (const role of roles) {
      console.log(`${role}: ${await wallets[role].getChangeAddress()}`);
      console.log(`${role} pkh: ${await walletPaymentKeyHash(wallets[role])}`);
    }
    console.log(`script: ${getEscrowScript(networkId).address}`);
    return;
  }

  if (command === "balance") {
    for (const role of roles) {
      console.log(`${role}: ${await wallets[role].getLovelace()} lovelace`);
    }
    return;
  }

  if (command === "create-collateral") {
    const role = parseRole(arg);
    const txHash = await wallets[role].createCollateral();
    console.log(`${role} collateral tx: ${txHash}`);
    return;
  }

  const parties = {
    buyer: await walletPaymentKeyHash(wallets.buyer),
    seller: await walletPaymentKeyHash(wallets.seller),
    arbiter: await walletPaymentKeyHash(wallets.arbiter),
  };

  if (command === "lock") {
    const txHash = await lockEscrow({
      wallet: wallets.buyer,
      provider,
      parties,
      lovelace: process.env.LOCK_LOVELACE ?? "5000000",
      networkId,
    });

    console.log(`lock tx: ${txHash}`);
    return;
  }

  if (isRedeemCommand(command)) {
    const role = actionWallet[command];
    const txHash = await redeemEscrow({
      wallet: wallets[role],
      provider,
      parties,
      action: actionName[command],
      buyerAddress: await wallets.buyer.getChangeAddress(),
      sellerAddress: await wallets.seller.getChangeAddress(),
      networkId,
    });

    console.log(`${command} tx: ${txHash}`);
    return;
  }

  throw new Error(
    [
      "Unknown command.",
      "Use one of: generate-wallet, addresses, script-address, balance,",
      "create-collateral <buyer|seller|arbiter>, lock, release, refund,",
      "resolve-buyer, resolve-seller.",
    ].join(" "),
  );
}

function isRedeemCommand(command: string | undefined): command is keyof typeof actionName {
  return command !== undefined && command in actionName;
}

function parseRole(value: string | undefined): Role {
  if (value === "buyer" || value === "seller" || value === "arbiter") {
    return value;
  }

  throw new Error("Role must be buyer, seller, or arbiter.");
}

async function walletFromEnv(
  envName: string,
  provider: ReturnType<typeof blockfrostProvider>,
  networkId: 0 | 1,
) {
  const wallet = new MeshWallet({
    networkId,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: requiredEnv(envName).trim().split(/\s+/),
    },
  });

  await wallet.init();
  return wallet;
}

function network(): 0 | 1 {
  const raw = process.env.NETWORK_ID ?? "0";

  if (raw === "0" || raw === "1") {
    return Number(raw) as 0 | 1;
  }

  throw new Error("NETWORK_ID must be 0 for testnet or 1 for mainnet.");
}

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} in .env.`);
  }

  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
