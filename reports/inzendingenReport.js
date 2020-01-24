import cron from 'node-cron'
import { app, errorHandler, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeInt, sparqlEscapeDateTime, uuid } from 'mu';
import {generateCSV, createFileOnDisk, createReport} from '../helpers.js'
import fs from 'fs'
import { querySudo as query } from '@lblod/mu-auth-sudo';

export default {
  cronPattern: '0 0 * * *',
  name: 'inzendingenReport',
  execute: async () => {
    const reportData = {
      title: 'Inzendingen Report',
      description: 'Number of inzendingen by decision type'
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
    const fileName = `inzendingenReport-${uuid()}`
    const fileExtension = 'csv'
    const fileFormat = 'text/csv'
    const csv = generateCSV(['type', 'typeCount'], data)
    fs.writeFileSync(`/data/files/${fileName}.${fileExtension}`, csv)
    const fileStats = fs.statSync(`/data/files/${fileName}.${fileExtension}`)
    const fileInfo = {
      name: fileName,
      extension: fileExtension,
      format: fileFormat,
      created: new Date(fileStats.birthtime),
      size: fileStats.size,
      location: `${fileName}.${fileExtension}`
    }
    const file = await createFileOnDisk(fileInfo)
    await createReport(file, reportData)
  }
}
