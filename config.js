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
