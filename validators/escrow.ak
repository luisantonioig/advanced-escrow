use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}

pub type PubKeyHash =
  VerificationKeyHash

pub type EscrowDatum {
  buyer: PubKeyHash,
  seller: PubKeyHash,
  arbiter: PubKeyHash,
}

pub type EscrowRedeemer {
  Release
  Refund
  ResolveBuyer
  ResolveSeller
}

pub fn is_authorized(
  datum: EscrowDatum,
  action: EscrowRedeemer,
  signatories: List<PubKeyHash>,
) -> Bool {
  when action is {
    Release -> list.has(signatories, datum.buyer)
    Refund -> list.has(signatories, datum.seller)
    ResolveBuyer -> list.has(signatories, datum.arbiter)
    ResolveSeller -> list.has(signatories, datum.arbiter)
  }
}

validator escrow {
  spend(
    datum: Option<EscrowDatum>,
    redeemer: EscrowRedeemer,
    _utxo: OutputReference,
    tx: Transaction,
  ) {
    expect Some(escrow_datum) = datum
    is_authorized(escrow_datum, redeemer, tx.extra_signatories)
  }

  else(_) {
    fail
  }
}

const buyer = #"11111111111111111111111111111111111111111111111111111111"

const seller = #"22222222222222222222222222222222222222222222222222222222"

const arbiter = #"33333333333333333333333333333333333333333333333333333333"

const stranger = #"99999999999999999999999999999999999999999999999999999999"

const sample_datum = EscrowDatum { buyer, seller, arbiter }

test buyer_can_release_to_seller() {
  is_authorized(sample_datum, Release, [buyer])
}

test seller_can_refund_to_buyer() {
  is_authorized(sample_datum, Refund, [seller])
}

test arbiter_can_resolve_to_buyer() {
  is_authorized(sample_datum, ResolveBuyer, [arbiter])
}

test arbiter_can_resolve_to_seller() {
  is_authorized(sample_datum, ResolveSeller, [arbiter])
}

test stranger_cannot_release() {
  !is_authorized(sample_datum, Release, [stranger])
}

test buyer_cannot_refund_without_seller() {
  !is_authorized(sample_datum, Refund, [buyer])
}
