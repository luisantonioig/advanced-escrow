import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MeshWallet } from "@meshsdk/wallet";
import {
  SLOT_CONFIG_NETWORK,
  unixTimeToEnclosingSlot,
  type UTxO,
} from "@meshsdk/core";
import type { ScalusEmulator as ScalusEmulatorType } from "@meshsdk/scalus-emulator";
import {
  getEscrowScript,
  lockEscrow,
  redeemEscrow,
  walletPaymentKeyHash,
} from "../../src/escrow.js";
import type { EscrowAction } from "../../src/escrow.js";

// Scalus publishes a CommonJS bundle. Requiring the Mesh wrapper keeps this
// test runnable in Node without a bundler while production code remains ESM.
const require = createRequire(import.meta.url);
const { ScalusEmulator } = require("@meshsdk/scalus-emulator") as typeof import("@meshsdk/scalus-emulator");

const networkId = 0 as const;
const slotConfig = SLOT_CONFIG_NETWORK.preview;
const initialBalance = "100000000";
const escrowAmount = "5000000";

const mnemonics = {
  buyer: "topic march planet summer axis movie way wait pipe push novel fever",
  seller: "resist inform tribe best amused battle battle clerk slam blouse below victory",
  arbiter: "garden base elegant thunder liberty text discover legend brush common name hotel",
} as const;

type Role = keyof typeof mnemonics;

test("local emulator executes lock and release with the real Plutus validator", async () => {
  const fixture = await createFixture();

  await assertSuccessfulRedeem(fixture, "Release");
});

for (const action of ["Refund", "ResolveBuyer", "ResolveSeller"] as const) {
  test(`local emulator executes ${action} with the real Plutus validator`, async () => {
    await assertSuccessfulRedeem(await createFixture(), action);
  });
}

test("off-chain flow rejects a release signed by the seller", async () => {
  const fixture = await createFixture();
  await lock(fixture);

  await assert.rejects(
    redeemEscrow({
      wallet: fixture.wallets.seller,
      provider: fixture.provider,
      parties: fixture.parties,
      action: "Release",
      networkId,
    }),
    /required signer|signature|witness|validation/i,
  );
});

test("off-chain flow rejects an unknown escrow id before building a transaction", async () => {
  const fixture = await createFixture();
  await lock(fixture);

  await assert.rejects(
    redeemEscrow({
      wallet: fixture.wallets.buyer,
      provider: fixture.provider,
      parties: { ...fixture.parties, escrowId: "does-not-exist" },
      action: "Release",
      networkId,
    }),
    /No escrow UTxO found/,
  );
});

test("off-chain flow rejects ambiguous escrow state", async () => {
  const fixture = await createFixture();
  await lock(fixture);
  await lock(fixture);

  await assert.rejects(
    redeemEscrow({
      wallet: fixture.wallets.buyer,
      provider: fixture.provider,
      parties: fixture.parties,
      action: "Release",
      networkId,
    }),
    /Multiple escrow UTxOs found/,
  );
});

async function lock(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const txHash = await lockEscrow({
    wallet: fixture.wallets.buyer,
    provider: fixture.provider,
    parties: fixture.parties,
    lovelace: escrowAmount,
    networkId,
  });
  assert.match(txHash, /^[0-9a-f]{64}$/);
}

async function assertSuccessfulRedeem(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  action: EscrowAction,
) {
  await lock(fixture);

  const scriptUtxos = await fixture.provider.fetchAddressUTxOs(
    fixture.scriptAddress,
  );
  assert.equal(scriptUtxos.length, 1);
  assert.deepEqual(scriptUtxos[0]?.output.amount, [
    { unit: "lovelace", quantity: escrowAmount },
  ]);
  assert.ok(scriptUtxos[0]?.output.dataHash);

  const signer = action === "Release" ? "buyer" : action === "Refund" ? "seller" : "arbiter";
  const payout = action === "Release" || action === "ResolveSeller" ? "seller" : "buyer";
  const redeemTxHash = await redeemEscrow({
    wallet: fixture.wallets[signer],
    provider: fixture.provider,
    parties: fixture.parties,
    action,
    networkId,
  });

  assert.match(redeemTxHash, /^[0-9a-f]{64}$/);
  assert.equal(
    (await fixture.provider.fetchAddressUTxOs(fixture.scriptAddress)).length,
    0,
  );
  assert.ok(
    (await fixture.provider.fetchAddressUTxOs(fixture.addresses[payout])).some(
      (utxo) =>
        utxo.output.amount.some(
          ({ unit, quantity }) =>
            unit === "lovelace" && BigInt(quantity) >= BigInt(escrowAmount),
        ),
    ),
  );
}

async function createFixture() {
  const addresses = await getRoleAddresses();
  const initialUtxos: UTxO[] = Object.values(addresses).map((address, index) => ({
    input: {
      txHash: `${String(index + 1).repeat(64)}`,
      outputIndex: 0,
    },
    output: {
      address,
      amount: [{ unit: "lovelace", quantity: initialBalance }],
    },
  }));

  const provider = new ScalusEmulator(initialUtxos, slotConfig);
  await provider.setSlot(unixTimeToEnclosingSlot(Date.now(), slotConfig));

  const wallets = {
    buyer: await createWallet("buyer", provider),
    seller: await createWallet("seller", provider),
    arbiter: await createWallet("arbiter", provider),
  };

  const parties = {
    buyer: await walletPaymentKeyHash(wallets.buyer),
    seller: await walletPaymentKeyHash(wallets.seller),
    arbiter: await walletPaymentKeyHash(wallets.arbiter),
    escrowId: "integration-escrow-001",
  };

  return {
    provider,
    wallets,
    parties,
    addresses,
    scriptAddress: getEscrowScript(networkId).address,
  };
}

async function getRoleAddresses(): Promise<Record<Role, string>> {
  const result = {} as Record<Role, string>;

  for (const role of Object.keys(mnemonics) as Role[]) {
    const wallet = new MeshWallet({
      networkId,
      key: { type: "mnemonic", words: mnemonics[role].split(" ") },
    });
    await wallet.init();
    result[role] = await wallet.getChangeAddress();
  }

  return result;
}

async function createWallet(role: Role, provider: ScalusEmulatorType) {
  const wallet = new MeshWallet({
    networkId,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: mnemonics[role].split(" ") },
  });
  await wallet.init();
  return wallet;
}
