import { sparqlEscapeUri, sparqlEscapeString, sparqlEscapeInt, sparqlEscapeDateTime, uuid } from 'mu';
import { querySudo as query } from './sparql';
import fs from 'fs';

const DEFAULT_GRAPH = process.env.DEFAULT_GRAPH || 'http://mu.semte.ch/graphs/organizations/141d9d6b-54af-4d17-b313-8d1c30bc3f5b/LoketAdmin';
const separator = ';';
export function generateCSV(fields, data) {
  let result = '';
  const headerString = fields.join(separator);
  result += `${headerString}\n`;
  const csvRows = data.map((row) => {
    const dataRow = fields.map((header) => row[header]);
    return dataRow.join(separator);
  });
  result += `${csvRows.join('\n')}`;
  return result;
}

export async function createFileOnDisk({name, format, size, extension, created, location}) {
  const logicalFileUuid = uuid();
  const logicalFileURI = `http://data.lblod.info/files/${logicalFileUuid}`;
  const physicalFileUuid = uuid();
  const physicalFileURI = `share://${location}`;
  const queryString = `
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dbpedia: <http://dbpedia.org/ontology/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    INSERT DATA {
      GRAPH <http://mu.semte.ch/graphs/public> {
        ${sparqlEscapeUri(logicalFileURI)} a nfo:FileDataObject;
          mu:uuid ${sparqlEscapeString(logicalFileUuid)};
          nfo:fileName ${sparqlEscapeString(name)};
          dct:format ${sparqlEscapeString(format)};
          nfo:fileSize ${sparqlEscapeInt(size)};
          dbpedia:fileExtension ${sparqlEscapeString(extension)};
          dct:created ${sparqlEscapeDateTime(created)} .
        ${sparqlEscapeUri(physicalFileURI)} a nfo:FileDataObject;
          mu:uuid ${sparqlEscapeString(physicalFileUuid)};
          nfo:fileName ${sparqlEscapeString(name)};
          dct:format ${sparqlEscapeString(format)};
          nfo:fileSize ${sparqlEscapeInt(size)};
          dbpedia:fileExtension ${sparqlEscapeString(extension)};
          dct:created ${sparqlEscapeDateTime(created)};
          nie:dataSource ${sparqlEscapeUri(logicalFileURI)}.
      }
    }
  `;
  await query(queryString);
  return logicalFileURI;
}

export async function createReport(file, {title, description}) {
  const reportUUID = uuid();
  const reportURI = `http://data.lblod.info/id/reports/${reportUUID}`;
  const queryString = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(DEFAULT_GRAPH)} {
        ${sparqlEscapeUri(reportURI)} a <http://lblod.data.gift/vocabularies/reporting/Report>;
          mu:uuid ${sparqlEscapeString(reportUUID)};
          dct:title ${sparqlEscapeString(title)};
          dct:description ${sparqlEscapeString(description)};
          dct:created ${sparqlEscapeDateTime(new Date())};
          prov:generated ${sparqlEscapeUri(file)} .
      }
    }
  `;
  await query(queryString);
}

export async function generateReportFromData(data, attributes, reportInfo) {
  const fileName = `${reportInfo.filePrefix}-${uuid()}`;
  const fileExtension = 'csv';
  const fileFormat = 'text/csv';
  const csv = generateCSV(attributes, data);
  fs.writeFileSync(`/share/${fileName}.${fileExtension}`, csv);
  const fileStats = fs.statSync(`/share/${fileName}.${fileExtension}`);
  const fileInfo = {
    name: fileName,
    extension: fileExtension,
    format: fileFormat,
    created: new Date(fileStats.birthtime),
    size: fileStats.size,
    location: `${fileName}.${fileExtension}`
  };
  const file = await createFileOnDisk(fileInfo);
  await createReport(file, reportInfo);
}

export async function batchedQuery(queryString, batchSize=1000, maxNumberOfBatches=null) {
  let moreData = true;
  let actualIndex = 0;
  let response = undefined;
  let iteration = 0;
  while(moreData) {
    const batchedQueryString = `
      ${queryString}
      LIMIT ${batchSize}
      OFFSET ${actualIndex}
    `;
    const data = await query(batchedQueryString);
    if(!response) {
      response = data;
    } else {
      response.results.bindings = response.results.bindings.concat(data.results.bindings);
    }
    actualIndex += batchSize;
    if(data.results.bindings.length < batchSize) {
      moreData = false;
    }
    if(maxNumberOfBatches  && iteration >= maxNumberOfBatches){
      moreData = false;
    }
    ++iteration;
  }
  return response;
}
