# Basic Aiken + MeshJS Escrow

This is a minimal escrow example for Cardano using:

- Aiken for the on-chain validator.
- MeshJS for lock and redeem transactions.
- Aiken unit tests for the authorization rules.

Use this on a testnet, preferably Preprod. Do not use mainnet funds or real wallet seed phrases for this example.

## Escrow Rules

- `Release`: the buyer signs, and the client pays the seller.
- `Refund`: the seller signs, and the client pays the buyer.
- `ResolveBuyer`: the arbiter signs, and the client pays the buyer.
- `ResolveSeller`: the arbiter signs, and the client pays the seller.

The contract validates who is allowed to spend the escrow UTxO. The MeshJS client chooses the payout address when building the transaction. For production, the validator should also verify the payout output on-chain.

## Files

- `validators/escrow.ak`: Aiken validator and tests.
- `src/escrow.ts`: MeshJS helpers for locking and redeeming.
- `src/onchain.ts`: Node CLI used by the npm scripts below.
- `.env.example`: local environment template.
- `plutus.json`: generated Aiken blueprint.

## Install

```sh
npm ci
```

## Local Checks

```sh
npm run check
npm run build
```

## On-Chain Testnet Setup

### 1. Create A Blockfrost Preprod Project

Create a Blockfrost account and add a project for the `preprod` network. Copy the `project_id`; this is the API key used by the scripts.

Blockfrost setup guide: https://developers.cardano.org/docs/get-started/infrastructure/api-providers/blockfrost/get-started/

### 2. Create `.env`

```sh
cp .env.example .env
```

Edit `.env`:

```env
NETWORK_ID=0
BLOCKFROST_PROJECT_ID=preprodYourBlockfrostProjectIdHere
LOCK_LOVELACE=5000000

BUYER_MNEMONIC="replace with a 24 word test wallet mnemonic"
SELLER_MNEMONIC="replace with a 24 word test wallet mnemonic"
ARBITER_MNEMONIC="replace with a 24 word test wallet mnemonic"
```

`NETWORK_ID=0` is for testnets. Keep `.env` private.

### 3. Generate Test Wallet Mnemonics

Run this three times and paste each output into `.env` as buyer, seller, and arbiter:

```sh
npm run wallet:generate
```

These are test wallets only. Never paste a real wallet seed phrase here.

### 4. Build The Project

```sh
npm run build
```

### 5. Print Addresses

```sh
npm run wallet:addresses
```

This prints:

- buyer address and payment key hash
- seller address and payment key hash
- arbiter address and payment key hash
- script address

### 6. Fund Test Wallets

Use the Cardano Testnet Faucet and select `preprod` plus `Receive test ADA`.

Faucet: https://docs.cardano.org/cardano-testnet/tools/faucet/

For the happy path, fund the buyer address because the buyer locks the escrow and later signs `Release`. For `Refund`, also fund the seller. For arbiter paths, also fund the arbiter. Each signer needs enough tAda for fees and collateral.

Suggested starting amounts:

- buyer: 15-20 tAda
- seller: 5-10 tAda if testing `Refund`
- arbiter: 5-10 tAda if testing `ResolveBuyer` or `ResolveSeller`

Check balances:

```sh
npm run wallet:balance
```

### 7. Create Collateral

Plutus script spending requires collateral. Create collateral for whichever wallet will redeem the escrow.

Happy path:

```sh
npm run wallet:collateral:buyer
```

Refund path:

```sh
npm run wallet:collateral:seller
```

Arbiter paths:

```sh
npm run wallet:collateral:arbiter
```

Wait a few moments after each collateral transaction, then check balances again.

```sh
npm run wallet:balance
```

## On-Chain Escrow Flows

### Happy Path: Buyer Releases To Seller

Lock 5 tAda at the escrow script:

```sh
npm run escrow:lock
```

Wait for the transaction to appear on Preprod, then release it to the seller:

```sh
npm run escrow:release
```

### Refund Path: Seller Refunds Buyer

Lock again:

```sh
npm run escrow:lock
```

Refund to the buyer:

```sh
npm run escrow:refund
```

### Arbiter Resolves To Buyer

Lock again:

```sh
npm run escrow:lock
```

Resolve to buyer:

```sh
npm run escrow:resolve-buyer
```

### Arbiter Resolves To Seller

Lock again:

```sh
npm run escrow:lock
```

Resolve to seller:

```sh
npm run escrow:resolve-seller
```

## Script Reference

```sh
npm run escrow:address
```

## Troubleshooting

- `Missing BLOCKFROST_PROJECT_ID in .env`: create `.env` from `.env.example`.
- `No collateral found`: run the matching `wallet:collateral:*` script and wait for confirmation.
- `No escrow UTxO found`: wait for the lock transaction to confirm, verify you are using the same `.env`, and ensure `LOCK_LOVELACE` has not changed in a way that affects your test expectations.
- `Insufficient input`: fund the signer wallet with more test ada from the faucet.
- Wrong network errors: make sure the Blockfrost project is for `preprod` and `NETWORK_ID=0`.

## Available Scripts

```sh
npm run wallet:generate
npm run wallet:addresses
npm run wallet:balance
npm run wallet:collateral:buyer
npm run wallet:collateral:seller
npm run wallet:collateral:arbiter

npm run escrow:address
npm run escrow:lock
npm run escrow:release
npm run escrow:refund
npm run escrow:resolve-buyer
npm run escrow:resolve-seller
```

# advanced-escrow
