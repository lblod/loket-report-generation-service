# Report Generation Service
The report generation service provides a way of generating reports from the data represented in your virtuoso database, as well as, a set of helpers for this purpose.

## Add the service to your stack

In order to add the report generation service to your app you have to copy and paste the following snippet to your docker-compose.yml

```yaml
report-generation:
    image: lblod/loket-report-generation-service:0.1.0
    links:
      - database:database
    volumes:
      - ./data/files:/share
      - ./config/reports:/app/reports
```

As you can see there are 2 volumes, first the one mounted to `/share` is the one where the reports will be written to, the path is important because is related to the file info written to the database. The other volume, mounted to `/confid/reports` is where the reports code will be.


## Defining reports

### index.js
In order to define a report you have to create a file in the volume connecting to `/app/reports` called `index.js` this file will be the one in charge of exporting an array of report objects. For example:
```js
import BestuurseenhedenReport from './bestuurseenhedenReport'
import BerichtencentrumMessagesReport from './berichtencentrumMessages'
import InzendingenReport from './inzendingenReport'
import AccountReport from './accountReport'
import bbcdrReport from './bbcdrReport'
import sameRrnReport from './sameRrnReport'
import failedSyncToMft from './failedSyncToMft'


export default [
  BestuurseenhedenReport,
  BerichtencentrumMessagesReport,
  InzendingenReport,
  AccountReport,
  bbcdrReport,
  sameRrnReport,
  failedSyncToMft
]
```

This file imports 4 reports from the same directory and exports an array containing all of them

### reports
Each of the report files will export and object containing 3 properties: `cronPattern`, `name` and `execute`

- `cronPattern`: defines when will be the report executed automatically
- `name`: Is the name used for executing the report manually
- `execute`: Defines the function that will be executed in order to create the report

Also the reports can access some helper functions that you can import from `../helpers`, those functions are the following:
- `generateReportFromData(data, attributes, reportInfo)`: it generates the report from an array of objects, the data attribute is the array of objects.The attributes is an array of strings containing the name of the attributes you want to include in the report. And the reportInfo is an object containing the title of the report, its description and a prefix for the files generated

Example of report file:

```js
import {generateReportFromData} from '../helpers.js'
import { querySudo as query } from '@lblod/mu-auth-sudo';

export default {
  cronPattern: '0 0 * * *',
  name: 'inzendingenReport',
  execute: async () => {
    const reportData = {
      title: 'Inzendingen Report',
      description: 'Number of inzendingen by decision type',
      filePrefix: 'inzendingen'
    }
    console.log('Generate Inzendingen Report')
    const queryString = `
      PREFIX toezicht: <http://mu.semte.ch/vocabularies/ext/supervision/>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

      select ?type (COUNT(?type) as ?typeCount) where {
        GRAPH ?g {
          ?uri a toezicht:InzendingVoorToezicht;
            toezicht:decisionType ?typeURI.
        }
        GRAPH ?h {
          ?typeURI skos:prefLabel ?type.
        }
      }
    `
    const queryResponse = await query(queryString)
    const data = queryResponse.results.bindings.map((inzendingen) => ({
      type: inzendingen.type.value,
      typeCount: inzendingen.typeCount.value,
    }))
    await generateReportFromData(data, ['type', 'typeCount'], reportData)
  }
}
```

