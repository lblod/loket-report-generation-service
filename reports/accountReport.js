import cron from 'node-cron'
import { app, errorHandler, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeInt, sparqlEscapeDateTime, uuid } from 'mu';
import {generateCSV, createFileOnDisk, createReport} from '../helpers.js'
import fs from 'fs'
import { querySudo as query } from '@lblod/mu-auth-sudo';

export default {
  cronPattern: '0 0 * * *',
  execute: async () => {
    const reportData = {
      title: 'Accounts Report',
      description: 'All accounts and the bestuurseenheid they belong'
    }
    console.log('Generate Account Report')
    const queryString = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      
      select distinct ?firstName ?familyName ?graph ?provider where {
        GRAPH ?graph {
          ?uri a foaf:Person;
            foaf:firstName ?firstName;
            foaf:familyName ?familyName;
            foaf:account ?accountURI .
          ?accountURI foaf:accountServiceHomepage ?provider.
          FILTER(?provider != <https://github.com/lblod/mock-login-service>)
        }
      }
    `
    const queryResponse = await query(queryString)
    const data = await Promise.all(queryResponse.results.bindings.map(async (account) => {
      const bestuurseenheidUUID = account.graph.value.split('/').pop()
      const bestuurseenheidQuery = `
        PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
        PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
        select distinct * where {
          ?uri mu:uuid ${sparqlEscapeString(bestuurseenheidUUID)};
            skos:prefLabel ?label .
        }
      `
      const bestuurseenheidResponse = await query(bestuurseenheidQuery)
      
      return {
        firstName: account.firstName.value,
        familyName: account.familyName.value,
        bestuurseenheid: bestuurseenheidResponse.results.bindings[0].label.value,
      }
    }))

    const fileName = `accountReport-${uuid()}`
    const fileExtension = 'csv'
    const fileFormat = 'text/csv'
    const csv = generateCSV(['firstName', 'familyName', 'bestuurseenheid'], data)
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
    console.log(fileInfo)
    const file = await createFileOnDisk(fileInfo)
    await createReport(file, reportData)
  }
}