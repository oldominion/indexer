import got from 'got';
import { makeWorkerUtils, WorkerUtils } from 'graphile-worker';
import uniqBy from 'lodash/uniqBy';
import get from 'lodash/get';
import { metrohash128 } from 'metrohash';
import dbConfig from '../knexfile';
import config from './config';
import {
  RoyaltyShares,
  BigmapDiffs,
  BigmapDiff,
  BigmapDiffAction,
  KeysEnum,
  Pattern,
  Transactions,
  Transaction,
  GetTransactionsFilters,
  Origination,
  Originations,
  GetOriginationsFilters,
} from '../types';
import { CURRENCY_MAPPINGS } from '../consts';
import isIPFS from 'is-ipfs';

require('dotenv').config();

export async function getLatestBlockLevel() {
  const count = await got(`${config.tzktApiUrl}/blocks/count`).json<number>();

  return count - 1;
}

let workerUtilsPromise: Promise<WorkerUtils> | null = null;

export async function getWorkerUtils() {
  if (workerUtilsPromise === null) {
    workerUtilsPromise = makeWorkerUtils({
      connectionString: dbConfig.connection,
    });
  }

  return await workerUtilsPromise;
}

function isMatchingDiff(
  diff: BigmapDiff,
  bigmapId: number | null,
  path: string,
  action: BigmapDiffAction | Array<BigmapDiffAction>,
  key?: string
) {
  const actions = Array.isArray(action) ? action : [action];

  return (
    (bigmapId === null || diff.bigmap === bigmapId) &&
    diff.path === path &&
    actions.includes(diff.action) &&
    (key ? diff.content.key === key : true)
  );
}

export function findDiff(
  diffs: BigmapDiffs,
  bigmapId: number | null,
  path: string,
  action: BigmapDiffAction | Array<BigmapDiffAction>,
  key?: string
) {
  return diffs.find((diff) => isMatchingDiff(diff, bigmapId, path, action, key));
}

export function filterDiffs(
  diffs: BigmapDiffs,
  bigmapId: number | null,
  path: string,
  action: BigmapDiffAction | Array<BigmapDiffAction>,
  key?: string
) {
  return diffs.filter((diff) => isMatchingDiff(diff, bigmapId, path, action, key));
}

const PATTERN_TO_PATH: KeysEnum<Pattern> = {
  entrypoint: 'parameter.entrypoint',
  target_address: 'target.address',
};

export function transactionMatchesPattern(transaction: Transaction, pattern: Pattern) {
  return Object.entries(pattern).every(([key, val]) => get(transaction, PATTERN_TO_PATH[key as keyof Pattern]) === val);
}

export function createEventId(handlerName: string, transaction: Transaction | Origination, idx: number = 0) {
  if (!('hash' in transaction && 'counter' in transaction && 'nonce' in transaction)) {
    throw new Error('transaction does not have all the properties needed (counter, hash and nonce) to create an eventId.');
  }

  return metrohash128(
    `${handlerName}:${transaction.hash}:${transaction.counter}:${transaction.nonce !== null ? transaction.nonce : 'unset'}:${idx}`
  );
}

export async function getBlockQuotes(level: number, currencies: Array<string>) {
  const result = await got(`${config.tzktApiUrl}/blocks/${level}`, {
    searchParams: {
      quote: currencies.join(','),
    },
  }).json<{ quote: Record<string, number> }>();

  return result.quote;
}

export async function getTransactions(
  filters: GetTransactionsFilters,
  perPage: number = 2000,
  maxPages: number = 20,
  select = 'id,level,timestamp,block,hash,counter,nonce,sender,target,amount,parameter,status,hasInternals,initiator,storage,diffs'
) {
  const allTransactions: Transactions = [];
  let currentPage = 0;

  do {
    const transactions = await got(`${config.tzktApiUrl}/operations/transactions`, {
      searchParams: {
        ...filters,
        offset: currentPage * perPage,
        limit: perPage,
        status: 'applied',
        select,
      },
    }).json<Transactions>();

    allTransactions.push(...transactions);

    if (transactions.length < perPage) {
      break;
    }

    currentPage++;
  } while (currentPage < maxPages);

  return uniqBy(allTransactions, 'id');
}

export async function getOriginations(filters: GetOriginationsFilters, perPage: number = 2000, maxPages: number = 20) {
  const allOriginations: Originations = [];
  let currentPage = 0;

  do {
    const originations = await got(`${config.tzktApiUrl}/operations/originations`, {
      searchParams: {
        ...filters,
        offset: currentPage * perPage,
        limit: perPage,
        status: 'applied',
        select: 'id,nonce,level,timestamp,block,counter,hash,initiator,sender,status,storage,originatedContract',
      },
    }).json<Originations>();

    allOriginations.push(...originations);

    if (originations.length < perPage) {
      break;
    }

    currentPage++;
  } while (currentPage < maxPages);

  return uniqBy(allOriginations, 'id');
}

type ObjktCurrencyTez = { tez: {} };
type ObjktCurrencyFa12 = { fa12: string };
type ObjktCurrency = ObjktCurrencyTez | ObjktCurrencyFa12;

export function extractObjktCurrency(currency: ObjktCurrency) {
  if ('tez' in currency) {
    return 'tez';
  }

  if ('fa12' in currency) {
    if (CURRENCY_MAPPINGS[currency['fa12']]) {
      return CURRENCY_MAPPINGS[currency['fa12']];
    }

    return currency['fa12'];
  }

  return null;
}

export function getTaskName(name: string) {
  const taskNamePrefix = process.env.TASK_NAME_PREFIX;

  if (taskNamePrefix) {
    return `${taskNamePrefix}_${name}`;
  }

  return name;
}

export function isTezLikeCurrency(currency: unknown) {
  if (!currency) {
    return true;
  }

  return currency === 'tez' || currency === 'otez';
}

export function isTezLikeCurrencyStrict(currency: unknown) {
  return currency === 'tez' || currency === 'otez';
}

export function splitsToRoyaltyShares(splits: Array<{ pct: string; address: string }>, totalRoyalties: string): RoyaltyShares {
  const totalRoyaltiesInt = parseInt(totalRoyalties, 10);

  const shares = splits.reduce<Record<string, string>>((memo, split) => {
    const pct = parseInt(split.pct, 10);

    memo[split.address] = String(totalRoyaltiesInt * pct);

    return memo;
  }, {});

  return {
    decimals: 6,
    shares,
  };
}

export function royaltiesToRoyaltyShares(receiverAddress: string, totalRoyalties: string, decimals: number = 3): RoyaltyShares {
  return {
    decimals,
    shares: {
      [receiverAddress]: totalRoyalties,
    },
  };
}

export function normalizeMetadataIpfsUri(metadataUri: string) {
  let newMetadataUri = metadataUri;

  if (!metadataUri.toLowerCase().startsWith('ipfs://') && isIPFS.cid(metadataUri)) {
    newMetadataUri = `ipfs://${metadataUri}`;
  }

  if (metadataUri.startsWith('ipfs://ipfs/')) {
    // sometimes the case for rarible tokens
    newMetadataUri = newMetadataUri.replace('ipfs://ipfs/', 'ipfs://');
  }

  return newMetadataUri;
}
