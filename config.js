import * as env from 'env-var';

export const CREATOR =
  'http://lblod.data.gift/services/loket-report-generation-service';

export const DEFAULT_GRAPH = env
  .get('DEFAULT_GRAPH')
  .required()
  .default(
    'http://mu.semte.ch/graphs/organizations/141d9d6b-54af-4d17-b313-8d1c30bc3f5b/LoketAdmin',
  )
  .asUrlString();

export const ONLY_KEEP_LATEST_REPORT = env
  .get('ONLY_KEEP_LATEST_REPORT')
  .default('false')
  .asBool();

export const INSERT_BATCH_SIZE = env
  .get('INSERT_BATCH_SIZE')
  .default('100')
  .asIntPositive();

export const DIRECT_DATABASE_CONNECTION = env
  .get('DIRECT_DATABASE_CONNECTION')
  .required()
  .default('http://virtuoso:8890/sparql')
  .asUrlString();

export const MU_SPARQL_ENDPOINT = env
  .get('MU_SPARQL_ENDPOINT')
  .required()
  .default('http://database:8890/sparql')
  .asUrlString();