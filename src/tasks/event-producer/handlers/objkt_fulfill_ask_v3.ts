import get from 'lodash/get';
import omit from 'lodash/omit';
import { assert, object, string, Describe, optional } from 'superstruct';
import { ContractAddress, TezosAddress, IsoDateString, PositiveInteger, PgBigInt } from '../../../lib/validators';
import { TransactionHandler, TokenEvent, SaleEventInterface } from '../../../types';
import { findDiff, createEventId, extractObjktCurrency, isTezLikeCurrencyStrict } from '../../../lib/utils';
import { OBJKT_CONTRACT_MARKETPLACE_V3, SALE_INTERFACE } from '../../../consts';
import { tokenSaleEventFields, artistAddressField, askIdField } from '../event-fields-meta';

export const EVENT_TYPE_OBJKT_FULFILL_ASK_V3 = 'OBJKT_FULFILL_ASK_V3';

export interface ObjktFulfillAskV3Event extends TokenEvent {
  type: typeof EVENT_TYPE_OBJKT_FULFILL_ASK_V3;
  implements: SaleEventInterface;
  ask_id: string;
  seller_address: string;
  buyer_address: string;
  artist_address?: string;
  price: string;
}

const ObjktFulfillAskV3EventSchema: Describe<Omit<ObjktFulfillAskV3Event, 'type' | 'implements'>> = object({
  id: string(),
  opid: PgBigInt,
  timestamp: IsoDateString,
  level: PositiveInteger,
  fa2_address: ContractAddress,
  token_id: string(),
  ophash: string(),
  ask_id: PgBigInt,
  seller_address: TezosAddress,
  buyer_address: TezosAddress,
  artist_address: optional(TezosAddress),
  price: PgBigInt,
});

const ObjktFulfillAskV2Handler: TransactionHandler<ObjktFulfillAskV3Event> = {
  source: 'transaction',

  type: EVENT_TYPE_OBJKT_FULFILL_ASK_V3,

  meta: {
    eventDescription: `An ask was fulfilled on objkt.com (marketplace contract: KT1CePTyk6fk4cFr6fasY5YXPGks6ttjSLp4).`,
    eventFields: [...tokenSaleEventFields, artistAddressField, askIdField],
  },

  accept: {
    entrypoint: 'fulfill_ask',
    target_address: OBJKT_CONTRACT_MARKETPLACE_V3,
  },

  exec: (transaction) => {
    const askId = get(transaction, 'parameter.value.ask_id');
    const diff = findDiff(get(transaction, 'diffs')!, 574013, 'asks', ['remove_key', 'update_key'], askId);
    const price = String(get(transaction, 'amount'));
    const fa2Address = get(diff, 'content.value.token.address');
    const tokenId = get(diff, 'content.value.token.token_id');
    const buyerAddress = get(transaction, 'sender.address');
    //const artistAddress = get(diff, 'content.value.artist');
    const sellerAddress = get(diff, 'content.value.creator');

    const currency = extractObjktCurrency(get(diff, 'content.value.currency'));

    if (!isTezLikeCurrencyStrict(currency)) {
      throw new Error(`unsupported currency`);
    }

    const id = createEventId(EVENT_TYPE_OBJKT_FULFILL_ASK_V3, transaction);

    const event: ObjktFulfillAskV3Event = {
      id,
      type: EVENT_TYPE_OBJKT_FULFILL_ASK_V3,
      implements: SALE_INTERFACE,
      opid: String(transaction.id),
      ophash: transaction.hash,
      level: transaction.level,
      timestamp: transaction.timestamp,
      price,
      fa2_address: fa2Address,
      token_id: tokenId,
      //artist_address: artistAddress,
      buyer_address: buyerAddress,
      seller_address: sellerAddress,
      ask_id: askId,
    };

    assert(omit(event, ['type', 'implements']), ObjktFulfillAskV3EventSchema);

    return event;
  },
};

export default ObjktFulfillAskV2Handler;
