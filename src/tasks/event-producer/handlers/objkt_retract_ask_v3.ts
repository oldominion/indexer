import get from 'lodash/get';
import omit from 'lodash/omit';
import { assert, object, string, Describe, optional } from 'superstruct';
import { ContractAddress, TezosAddress, IsoDateString, PositiveInteger, PgBigInt } from '../../../lib/validators';
import { TransactionHandler, TokenEvent } from '../../../types';
import { findDiff, createEventId } from '../../../lib/utils';
import { OBJKT_CONTRACT_MARKETPLACE_V3 } from '../../../consts';
import { tokenEventFields, artistAddressField, sellerAddressField, askIdField } from '../event-fields-meta';

export const EVENT_TYPE_OBJKT_RETRACT_ASK_V3 = 'OBJKT_RETRACT_ASK_V3';

export interface ObjktRetractAskV3Event extends TokenEvent {
  type: typeof EVENT_TYPE_OBJKT_RETRACT_ASK_V3;
  ask_id: string;
  artist_address?: string;
  seller_address: string;
}

const ObjktRetractAskV3EventSchema: Describe<Omit<ObjktRetractAskV3Event, 'type'>> = object({
  id: string(),
  opid: PgBigInt,
  timestamp: IsoDateString,
  level: PositiveInteger,
  fa2_address: ContractAddress,
  token_id: string(),
  ophash: string(),
  artist_address: optional(TezosAddress),
  seller_address: TezosAddress,
  ask_id: PgBigInt,
});

const ObjktRetractAskV2Handler: TransactionHandler<ObjktRetractAskV3Event> = {
  source: 'transaction',

  type: EVENT_TYPE_OBJKT_RETRACT_ASK_V3,

  meta: {
    eventDescription: `An ask was canceled on objkt.com (marketplace contract: KT1CePTyk6fk4cFr6fasY5YXPGks6ttjSLp4).`,
    eventFields: [...tokenEventFields, artistAddressField, sellerAddressField, askIdField],
  },

  accept: {
    entrypoint: 'retract_ask',
    target_address: OBJKT_CONTRACT_MARKETPLACE_V3,
  },

  exec: (transaction) => {
    const askId = get(transaction, 'parameter.value');
    const diff = findDiff(get(transaction, 'diffs')!, 574013, 'asks', 'remove_key', askId);
    const fa2Address = get(diff, 'content.value.token.address');
    const tokenId = get(diff, 'content.value.token.token_id');
    //const artistAddress = get(diff, 'content.value.artist');
    const sellerAddress = get(diff, 'content.value.creator');
    const id = createEventId(EVENT_TYPE_OBJKT_RETRACT_ASK_V3, transaction);

    const event: ObjktRetractAskV3Event = {
      id,
      type: EVENT_TYPE_OBJKT_RETRACT_ASK_V3,
      opid: String(transaction.id),
      ophash: transaction.hash,
      level: transaction.level,
      timestamp: transaction.timestamp,
      fa2_address: fa2Address,
      //artist_address: artistAddress, // TODO: add
      seller_address: sellerAddress,
      token_id: tokenId,
      ask_id: askId,
    };

    assert(omit(event, ['type']), ObjktRetractAskV3EventSchema);

    return event;
  },
};

export default ObjktRetractAskV2Handler;
