# Report Generation Service

The report generation service provides a way of generating reports from the
data represented in your Virtuoso database as well as a set of helpers for this
purpose.

## Add to your stack

In order to add the report generation service to your app you have to copy and
paste the following snippet to your docker-compose.yml

```yaml
report-generation:
  image: lblod/loket-report-generation-service:0.6.3
  volumes:
    - ./data/files:/share
    - ./config/reports:/config
```

There are 2 volumes. The one mounted to `/share` is where the reports will be
written to. The path is important because it is related to the file info
written to the database. The other volume, mounted to `/config` is where the
report code will be (the `index.js` file, see below).

## Environment variables

The following enviroment variables can be configured:
* `DEFAULT_GRAPH`: Default graph in which the file will be stored in the db. Defaults to `http://mu.semte.ch/graphs/organizations/141d9d6b-54af-4d17-b313-8d1c30bc3f5b/LoketAdmin`
* `ONLY_KEEP_LATEST_REPORT`: Boolean that allows, when set to `true`, to only keep the most recent version of a report during its creation and to delete oder versions. Defaults to `false`

## Defining reports

### `index.js`

In order to define a report you have to create a file in the volume connecting
to `/config` called `index.js`. This file will be in charge of exporting an
array of report objects. For example:

```js
import BestuurseenhedenReport from './bestuurseenhedenReport'
import BerichtencentrumMessagesReport from './berichtencentrumMessages'
import InzendingenReport from './inzendingenReport'
import AccountReport from './accountReport'
import ShaclReport from './shaclReport'

export default [
  BestuurseenhedenReport,
  BerichtencentrumMessagesReport,
  InzendingenReport,
  AccountReport,
  ShaclReport
];
```

This file imports 5 reports from the same directory and exports an array
containing all of them.

### Reports

Each of the report files should export and object containing 3 properties:
`cronPattern`, `name` and `execute`

* `cronPattern`: defines when the report will be executed automatically.
* `name`: the name used for manually running the report via an API call (see
  later).
* `execute`: Defines the function that will be executed in order to create the
  report.

The reports can access some helper functions that you can import from
`../helpers`. Those functions include (among others):

* `generateReportFromData(data, attributes, reportInfo)`: it generates the
  report from an array of objects.
  * The `data` argument is the array of objects where every object has at least
    the keys that are in the `attributes` argument.
  * The `attributes` argument is an array of strings containing the names of
    the properties you want to include in the report.
  * The `reportInfo` is an object containing the `title` of the report, its
    `description` and a `filePrefix` for the files generated.
* `batchedQuery(queryString, batchSize = 1000, maxNumberOfBatches =
  undefined)`: this adds `LIMIT` and `OFFSET` clauses to a given query and
  executes the resulting query with increasing offset to collect large
  datasets. This helps to split large result sets into smaller bits. The
  results are concatenated into one large set as the return value for this
  function.
  * `queryString` is the SPARQL query that does not yet have `LIMIT` and
    `OFFSET` clauses.
  * `batchSize` (defaults to 1000) is the allowed result size per query.
  * `maxNumberOfBatches` (defaults to being unset) is the maximum number of
    batches to perform. This can be used to get a subset of all the available
    data in the database in combination with the `batchSize`. E.g.: only list
    the top 10 entities with `batchSize = 10, maxNumberOfBatches = 1`.

Example of a report file:

```js
import { generateReportFromData } from '../helpers.js';
import { querySudo } from '@lblod/mu-auth-sudo';

export default {
  cronPattern: '0 0 * * *',
  name: 'inzendingenReport',
  execute: async () => {
    const reportData = {
      title: 'Inzendingen Report',
      description: 'Number of inzendingen by decision type',
      filePrefix: 'inzendingen',
    };
    const queryString = `
      PREFIX toezicht: <http://mu.semte.ch/vocabularies/ext/supervision/>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

      SELECT ?type (COUNT(?type) AS ?typeCount) WHERE {
        GRAPH ?g {
          ?uri a toezicht:InzendingVoorToezicht ;
               toezicht:decisionType ?typeURI.
        }
        GRAPH ?h {
          ?typeURI skos:prefLabel ?type.
        }
      }`;
    const queryResponse = await querySudo(queryString);
    const data = queryResponse.results.bindings.map((inzendingen) => ({
      type: inzendingen.type.value,
      typeCount: inzendingen.typeCount.value,
    }));
    await generateReportFromData(data, ['type', 'typeCount'], reportData);
  },
};
```

### Example SHACL Report

Example of a SHACL report file that reads 100 triples of Mandatarissen and runs a SHACL shape against each Mandataris:

```js
import { querySudo } from '@lblod/mu-auth-sudo';

import { parseTurtleString, convertConstructQueryResponseToStore, validateDataset } from '../helpers.js';

export default {
  cronPattern: '0 0 * * *',
  name: 'shaclReport',
  execute: async () => {
    const reportData = {
      title: 'Shacl Report',
      description: 'Example of validating Mandatarissen with SHACL shape',
      filePrefix: 'shacl',
    };
    
    const queryString = `
      CONSTRUCT {
        ?mandataris ?pMandataris ?oMandataris .
      }
      WHERE {
        ?mandataris a <http://data.vlaanderen.be/ns/mandaat#Mandataris> ;
                  ?pMandataris ?oMandataris .     
      }
      LIMIT 100
      `;
    const queryResponse = await querySudo(queryString);
    const dataset = convertConstructQueryResponseToStore(queryResponse);

    const shape = `
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

      <http://example.org/shape>
      a sh:NodeShape ;
      sh:targetClass <http://data.vlaanderen.be/ns/mandaat#Mandataris> ;
      sh:prefixes [ sh:declare [
        a sh:PrefixDeclaration ;
        sh:namespace "http://data.vlaanderen.be/ns/mandaat#"^^xsd:anyURI ;
        sh:prefix "mandaat" ;
      ] ];
      sh:property [
        sh:name "isBestuurlijkeAliasVan" ;
        sh:description "De persoon die de mandatarisrol vervult." ;
        sh:path <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ;
        sh:class <http://www.w3.org/ns/person#Person> ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
      ] ;
      sh:sparql [
        sh:select """
          PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>

          SELECT $this ?value
          WHERE {
              $this a mandaat:Mandataris .
              FILTER NOT EXISTS {
                  $this mandaat:status ?mandatarisStatusCode .
              }
          
              BIND ("You can include variables here for feedback." as ?value)
          }
        """ ;
        sh:message "Mandataris heeft geen status."
      ] .
    `;
    const shapesDataset = await parseTurtleString(shape);

    const report = await validateDataset(dataset, shapesDataset);

    console.log(report.dataset); // returns RDF/JS Store
  },
};
```

## Manually trigger reports

In order to test your reports, you will usually have the need for manually
triggering one. For this you can send a POST request to `/reports` with the
following JSON payload, where `myReport` is the name defined in your report
file.

```bash
curl -X POST http://localhost/reports -H 'Content-Type: application/json' -d '{"data":{"attributes":{"reportName":"myReport"}}}'
```
