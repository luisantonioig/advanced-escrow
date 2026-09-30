use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address
use cardano/assets
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}

pub type PubKeyHash =
  VerificationKeyHash

pub type EscrowDatum {
  buyer: PubKeyHash,
  seller: PubKeyHash,
  arbiter: PubKeyHash,
  escrow_id: ByteArray,
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

fn beneficiary(action: EscrowRedeemer, datum: EscrowDatum) -> PubKeyHash {
  when action is {
    Release -> datum.seller
    Refund -> datum.buyer
    ResolveBuyer -> datum.buyer
    ResolveSeller -> datum.seller
  }
}

fn has_tagged_payout(
  action: EscrowRedeemer,
  datum: EscrowDatum,
  own_ref: OutputReference,
  own_value: assets.Value,
  outputs: List<Output>,
) -> Bool {
  let expected_address = address.from_verification_key(
    beneficiary(action, datum),
  )

  let matching_outputs = outputs
    |> list.filter(
        fn(output) {
          when output.datum is {
            InlineDatum(tag) -> and {
                tag == own_ref,
                output.address == expected_address,
                output.value == own_value,
              }
            _ -> False
          }
        },
      )

  list.length(matching_outputs) == 1
}

validator escrow {
  spend(
    datum: Option<EscrowDatum>,
    redeemer: EscrowRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(escrow_datum) = datum
    expect Some(own_input) = list.find(
      tx.inputs,
      fn(input) { input.output_reference == own_ref },
    )

    and {
      is_authorized(escrow_datum, redeemer, tx.extra_signatories),
      has_tagged_payout(
        redeemer,
        escrow_datum,
        own_ref,
        own_input.output.value,
        tx.outputs,
      ),
    }
  }

  else(_) {
    fail
  }
}

const buyer = #"11111111111111111111111111111111111111111111111111111111"

const seller = #"22222222222222222222222222222222222222222222222222222222"

const arbiter = #"33333333333333333333333333333333333333333333333333333333"

const stranger = #"99999999999999999999999999999999999999999999999999999999"

const sample_escrow_id = #"657363726f772d312d74657374"

const sample_datum =
  EscrowDatum { buyer, seller, arbiter, escrow_id: sample_escrow_id }

test escrow_datum_contains_unique_id() {
  sample_datum.escrow_id == sample_escrow_id
}

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

const sample_ref =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 0,
  }

const sample_value = assets.zero

const valid_payout =
  Output {
    address: address.from_verification_key(seller),
    value: sample_value,
    datum: InlineDatum(sample_ref),
    reference_script: None,
  }

test tagged_payout_matches_buyer_release() {
  has_tagged_payout(
    Release,
    sample_datum,
    sample_ref,
    sample_value,
    [valid_payout],
  )
}

test tagged_payout_rejects_wrong_reference() {
  let wrong_ref = OutputReference {
    transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output_index: 0,
  }

  !has_tagged_payout(
    Release,
    sample_datum,
    wrong_ref,
    sample_value,
    [valid_payout],
  )
}
