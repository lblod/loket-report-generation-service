import {
  sparqlEscapeUri,
  sparqlEscapeString,
  sparqlEscapeInt,
  sparqlEscapeDateTime,
  uuid,
} from 'mu';
import { querySudo } from '@lblod/mu-auth-sudo';
import fs from 'fs';
import { DEFAULT_GRAPH, ONLY_KEEP_LATEST_REPORT } from './config';

const SEPARATOR = ';';

export function generateCSV(fields, data) {
  const headerString = fields.join(SEPARATOR);
  const csvRows = data.map((row) => {
    return fields
      .map((propertyName) => {
        let dt = row[propertyName] || '';
        //Remove unmatched double quotes
        dt =
          [...dt.matchAll(/"/g)].length % 2 !== 0 ? dt.replace(/"/g, '') : dt;
        //Escape the use of the semicolon
        dt = dt.includes(SEPARATOR) ? `"${dt}"` : dt;
        return dt;
      })
      .join(SEPARATOR);
  });
  return `${headerString}\n${csvRows.join('\n')}`;
}

export async function createFileOnDisk({
  name,
  format,
  size,
  extension,
  created,
  location,
}) {
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
      GRAPH ${sparqlEscapeUri(DEFAULT_GRAPH)} {
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
  await querySudo(queryString);
  return logicalFileURI;
}

export async function createReport(file, { title, description }) {
  const reportUUID = uuid();
  const reportURI = `http://data.lblod.info/id/reports/${reportUUID}`;
  const queryString = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(DEFAULT_GRAPH)} {
        ${sparqlEscapeUri(reportURI)}
          a <http://lblod.data.gift/vocabularies/reporting/Report>;
          mu:uuid ${sparqlEscapeString(reportUUID)};
          dct:title ${sparqlEscapeString(title)};
          dct:description ${sparqlEscapeString(description)};
          dct:created ${sparqlEscapeDateTime(new Date())};
          prov:generated ${sparqlEscapeUri(file)} .
      }
    }
  `;
  await querySudo(queryString);
}

export async function generateReportFromData(data, attributes, reportInfo) {
  const fileName = `${reportInfo.filePrefix}-${uuid()}`;
  const fileExtension = 'csv';
  const fileFormat = 'text/csv';
  const csv = generateCSV(attributes, data);
  const filePath = `/share/${fileName}.${fileExtension}`;
  let outputDirectory = filePath.split('/');
  outputDirectory.pop();
  outputDirectory = outputDirectory.join('/');

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(filePath, csv);

  const fileStats = fs.statSync(`/share/${fileName}.${fileExtension}`);
  const fileInfo = {
    name: fileName,
    extension: fileExtension,
    format: fileFormat,
    created: new Date(fileStats.birthtime),
    size: fileStats.size,
    location: `${fileName}.${fileExtension}`,
  };
  const file = await createFileOnDisk(fileInfo);
  await createReport(file, reportInfo);

  if (ONLY_KEEP_LATEST_REPORT) {
    await deletePreviousReports(reportInfo);
  }
}

async function deletePreviousReports(reportInfo) {
  const reportsToDelete = await getPreviousReports(reportInfo.title);

  for (const report of reportsToDelete) {
    await deleteFileInDatabase(report.uri);
    await deleteFileOnDisk(report.physicalFile);
  }
}

async function getPreviousReports(title) {
  const queryString = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?reportUri ?physicalFile
    WHERE {
      GRAPH ${sparqlEscapeUri(DEFAULT_GRAPH)} {
        ?reportUri a <http://lblod.data.gift/vocabularies/reporting/Report>;
          dct:title ${sparqlEscapeString(title)};
          dct:created ?created;
          prov:generated ?file .

        ?physicalFile nie:dataSource ?file .
      }
    }
    ORDER BY DESC(?created)
  `;
  const result = await querySudo(queryString);

  if (result.results.bindings.length) {
    const reports = result.results.bindings.map((o) => {
      return {
        uri: o.reportUri.value,
        physicalFile: o.physicalFile.value,
      };
    });
    reports.shift(); // Most recent report should stay away from being deleted
    return reports;
  } else {
    return [];
  }
}

async function deleteFileInDatabase(uri) {
  const queryString = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    DELETE WHERE {
      GRAPH ${sparqlEscapeUri(DEFAULT_GRAPH)} {
        ${sparqlEscapeUri(uri)} prov:generated ?file ;
          ?preport ?oreport .

        ?file ?pfile ?ofile .

        ?physicalFile nie:dataSource ?file ;
          ?pphysicalFile ?ophysicalFile .
      }
    }
  `;
  await querySudo(queryString);
}

async function deleteFileOnDisk(path) {
  try {
    const filePath = path.replace('share://', '/share/');
    fs.unlink(filePath, function () {
      console.log('Deleted file', filePath);
    });
  } catch (error) {
    console.warn(`Error removing file ${path}`);
    console.error(`${error?.message || error}`);
  }
}

export async function batchedQuery(
  queryString,
  batchSize = 1000,
  maxNumberOfBatches = null,
) {
  let moreData = true;
  let actualIndex = 0;
  let response = undefined;
  let iteration = 0;
  while (moreData) {
    const batchedQueryString = `
      ${queryString}
      LIMIT ${batchSize}
      OFFSET ${actualIndex}
    `;
    const data = await querySudo(batchedQueryString);
    if (!response) {
      response = data;
    } else {
      response.results.bindings = response.results.bindings.concat(
        data.results.bindings,
      );
    }
    actualIndex += batchSize;
    if (data.results.bindings.length < batchSize) {
      moreData = false;
    }
    if (maxNumberOfBatches && iteration >= maxNumberOfBatches) {
      moreData = false;
    }
    ++iteration;
  }
  return response;
}
