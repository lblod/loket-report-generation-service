import {
  sparqlEscapeUri,
  sparqlEscapeString,
  sparqlEscapeInt,
  sparqlEscapeDateTime,
  uuid,
} from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import fs from 'fs';
import {
  DEFAULT_GRAPH,
  ONLY_KEEP_LATEST_REPORT,
  INSERT_BATCH_SIZE,
  MU_SPARQL_ENDPOINT,
  DIRECT_DATABASE_CONNECTION,
} from './config';
import { DataFactory } from 'n3';
const { quad, literal, namedNode } = DataFactory;

import { SparqlJsonParser } from 'sparqljson-parse';
const sparqlJsonParser = new SparqlJsonParser();

import { Parser, Store, Writer } from 'n3';

import { readdir, readFile } from 'fs/promises';
import path from 'path';

const SEPARATOR = ';';

export function generateCSV(fields, data) {
  const headerString = fields.join(SEPARATOR);
  const csvRows = data.map((row) => {
    return fields
      .map((propertyName) => {
        let dt = row[propertyName] || '';
        //If special character: encapsulate
        if (dt.includes(SEPARATOR) || dt.match(/"/g)) {
          //Escape the use of double quotes by prepending a quote
          dt = dt.replace(/"/g, '""');
          //Encapsulate the use of the semicolon and the quotes
          dt = `"${dt}"`;
        }
        //Escape newlines and tabs (can also be done with just "-encapsulation)
        dt = dt.replace(/\n/g, '\\n');
        dt = dt.replace(/\t/g, '\\t');
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

/**
 * Function to validate a dataset using a SHACL shape
 *
 * @async
 * @function
 * @param { N3.Store } dataset - Store containing the data that is validated
 * @param { N3.Store } shapesDataset - Store containing the SHACL shapes
 * @param { string } overrideReportUri - Report URI that must be used
 * @returns { object } An object which include the `reportDataset` key
 */
export async function validateDataset(
  dataset,
  shapesDataset,
  overrideReportUri,
) {
  // Import ESM modules dynamically
  const rdf = await eval('import("rdf-ext")');
  const shacl = await eval('import("shacl-engine")');
  const sparqljs = await eval('import("shacl-engine/sparql.js")');

  const validator = new shacl.Validator(shapesDataset, {
    factory: rdf.default,
    validations: sparqljs.validations,
  });
  const report = await validator.validate({ dataset: dataset });

  // Enrich validation report by removing blank nodes, adding timestamp etc.
  const { reportDataset } = enrichValidationReport(
    report.dataset,
    shapesDataset,
    dataset,
    overrideReportUri,
  );
  return reportDataset;
}

export function addConstructQueryResponseToStore(store, response) {
  const rdfJsObjects = sparqlJsonParser.parseJsonResults(response);

  rdfJsObjects.forEach((quad) => {
    store.addQuad(
      quad.s,
      quad.p,
      quad.o,
      quad.g || undefined, // Optional: Include a graph if your RDFJS object contains it
    );
  });

  return store;
}

export async function parseTurtleString(turtleString) {
  const parser = new Parser();
  const store = new Store();

  if (!turtleString || turtleString.trim() === '') {
    return store; // Return an empty store if the input string is empty or only contains whitespace
  }
  const quads = parser.parse(turtleString);
  store.addQuads(quads);

  return store;
}

/**
 * Reads files from directory and merges all content into a single string
 * Each file content is separated with a newline
 *
 * @async
 * @function
 * @returns { string } The merged content of all files in the directory
 */
export async function mergeFilesContent(directory) {
  try {
    const files = await readdir(directory);

    if (files.length === 0) {
      console.log('No files found in the directory.');
      return;
    }

    // Loop over files and read their contents
    const contentPromises = files.map(async (file) => {
      const filePath = path.join(directory, file);
      return readFile(filePath, 'utf8');
    });

    // Wait for all file contents to be read
    const contents = await Promise.all(contentPromises);

    // Merge all content into a single field
    const mergedContent = contents.join('\n');
    return mergedContent;
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

/**
 * Enrich validation report with lmb:targetClassOfFocusNode, adds UUIDs, replaces blank nodes
 *
 * @async
 * @function
 * @param { N3.Store } reportDataset - Store containing the SHACL Report to enrich
 * @param { N3.Store } shapesDataset - Store containing the SHACL shapes
 * @param { N3.Store } dataDataset - Store containing the data that is validated
 * @param { string } overrideReportUri - Report URI that must be used
 * @returns { object } An object which include the `reportDataset` key
 */
function enrichValidationReport(
  reportDataset,
  shapesDataset,
  dataDataset,
  overrideReportUri,
) {
  enrichValidationResults(reportDataset, shapesDataset, dataDataset);

  enrichValidationReports(reportDataset, overrideReportUri);

  // There can still apear blank nodes, for example when using special forms of sh:path: sh:alternativePath, sh:inversePath etc
  const reportDatasetWithoutBlankNodes = replaceBlankNodes(reportDataset);
  return { reportDataset: reportDatasetWithoutBlankNodes };
}

function enrichValidationResults(reportDataset, shapesDataset, dataDataset) {
  const validationResults = reportDataset.match(
    null,
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/ns/shacl#ValidationResult'),
  );
  for (const validationResultQuad of validationResults) {
    // Replace blank node of ValidationResult with UUID-based URI
    const validationResultUUID = uuid();
    const validationResultURI = `http://data.lblod.info/id/validationresults/${validationResultUUID}`;

    const targetClass = getTargetClass(
      validationResultQuad.subject,
      reportDataset,
      shapesDataset,
      dataDataset,
    );

    const targetId = getTargetId(
      validationResultQuad.subject,
      reportDataset,
      dataDataset,
    );
    addTargetIdToValidationResult(
      validationResultQuad.subject,
      reportDataset,
      targetId,
    );

    // Do not include triples of validation result when ClassConstraintComponent
    const isClassConstraintComponent =
      reportDataset.match(
        validationResultQuad.subject,
        namedNode('http://www.w3.org/ns/shacl#sourceConstraintComponent'),
        namedNode('http://www.w3.org/ns/shacl#ClassConstraintComponent'),
      ).size > 0;

    if (!isClassConstraintComponent) {
      // Add targetClass to validation result
      if (targetClass)
        reportDataset.add(
          quad(
            validationResultQuad.subject,
            namedNode(
              'http://lblod.data.gift/vocabularies/lmb/targetClassOfFocusNode',
            ),
            namedNode(targetClass),
          ),
        );
      // Add UUID
      reportDataset.add(
        quad(
          validationResultQuad.subject,
          namedNode('http://mu.semte.ch/vocabularies/core/uuid'),
          literal(validationResultUUID),
        ),
      );
      // Add validation result triples with validationResultURI
      replaceBlankNodesOfValidationResult(
        validationResultQuad.subject,
        reportDataset,
        validationResultURI,
      );
    } else {
      // Remove original validation result triples that use blank node for validation result
      removeBlankNodesOfValidationResult(
        validationResultQuad.subject,
        reportDataset,
      );
    }
  }
}

/**
 * Enrich validation report with URI, uuid, created, replaces blank nodes
 *
 * @async
 * @function
 * @param { N3.Store } reportDataset - Store containing the SHACL Report to enrich
 * @param { string } overrideReportUri - Override report with this URI
 * @returns { void }
 */
function enrichValidationReports(reportDataset, overrideReportUri) {
  // Replace blank node of ValidationReport with UUID-based URI
  const validationReports = reportDataset.match(
    null,
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/ns/shacl#ValidationReport'),
  );
  for (const validationReportQuad of validationReports) {
    const reportUUID = uuid();
    const reportURI = overrideReportUri
      ? overrideReportUri
      : `http://data.lblod.info/id/reports/${reportUUID}`;
    const reportCreatedAt = new Date().toISOString();

    if (
      !reportDataset.has(
        quad(
          namedNode(reportURI),
          namedNode('http://mu.semte.ch/vocabularies/core/uuid'),
          null,
        ),
      )
    ) {
      // Add UUID
      reportDataset.add(
        quad(
          namedNode(reportURI),
          namedNode('http://mu.semte.ch/vocabularies/core/uuid'),
          literal(reportUUID),
        ),
      );
      // Add creation time stamp
      reportDataset.add(
        quad(
          namedNode(reportURI),
          namedNode('http://purl.org/dc/terms/created'),
          literal(
            reportCreatedAt,
            namedNode('http://www.w3.org/2001/XMLSchema#dateTime'),
          ),
        ),
      );
    }
    const triplesOfValidationReport = reportDataset.match(
      validationReportQuad.subject,
      null,
      null,
    );
    for (const resultQuad of triplesOfValidationReport) {
      // Only add conforms "true", when "false" is not already existing
      if (
        overrideReportUri &&
        resultQuad.predicate.value === 'http://www.w3.org/ns/shacl#conforms' &&
        !reportDataset.has(
          namedNode(reportURI),
          namedNode('http://www.w3.org/ns/shacl#conforms'),
          literal(false),
        )
      ) {
        reportDataset.add(
          quad(namedNode(reportURI), resultQuad.predicate, resultQuad.object),
        );
      } else {
        // Link existing triples to the report URI
        reportDataset.add(
          quad(namedNode(reportURI), resultQuad.predicate, resultQuad.object),
        );
      }
      // Remove triples with report blank node
      reportDataset.delete(
        quad(
          validationReportQuad.subject,
          resultQuad.predicate,
          resultQuad.object,
        ),
      );
    }
  }
}

function removeBlankNodesOfValidationResult(
  validationResultNode,
  reportDataset,
) {
  const triplesOfValidationResult = reportDataset.match(
    validationResultNode,
    null,
    null,
  );
  for (const resultQuad of triplesOfValidationResult)
    reportDataset.delete(resultQuad);
  const triplesPointingToValidationResult = reportDataset.match(
    null,
    null,
    validationResultNode,
  );
  for (const resultQuad of triplesPointingToValidationResult)
    reportDataset.delete(resultQuad);
}

function replaceBlankNodesOfValidationResult(
  validationResultNode,
  reportDataset,
  validationResultURI,
) {
  const triplesOfValidationResult = reportDataset.match(
    validationResultNode,
    null,
    null,
  );
  for (const resultQuad of triplesOfValidationResult) {
    if (resultQuad.predicate.value != 'http://www.w3.org/ns/shacl#sourceShape')
      reportDataset.add(
        quad(
          namedNode(validationResultURI),
          resultQuad.predicate,
          resultQuad.object,
        ),
      );
  }

  const triplesPointingToValidationResult = reportDataset.match(
    null,
    null,
    validationResultNode,
  );
  for (const resultQuad of triplesPointingToValidationResult) {
    reportDataset.add(
      quad(
        resultQuad.subject,
        resultQuad.predicate,
        namedNode(validationResultURI),
      ),
    );
  }
  // Remove original validation result triples that use blank node for validation result
  removeBlankNodesOfValidationResult(validationResultNode, reportDataset);
}

function addTargetIdToValidationResult(
  validationResultNode,
  reportDataset,
  targetId,
) {
  if (targetId) {
    reportDataset.add(
      quad(
        validationResultNode,
        namedNode(
          'http://lblod.data.gift/vocabularies/lmb/targetIdOfFocusNode',
        ),
        literal(targetId),
      ),
    );
  }
}

function getTargetClass(
  validationResultNode,
  reportDataset,
  shapesDataset,
  dataDataset,
) {
  // Retrieve targetClass of ValidationResult using the targetClass of the shape or type of instance
  const sourceShapeQuads = reportDataset.match(
    validationResultNode,
    namedNode('http://www.w3.org/ns/shacl#sourceShape'),
    null,
  );
  if (sourceShapeQuads.size) {
    const [sourceShapeQuad] = sourceShapeQuads;
    const targetClassInShapeQuads = shapesDataset.match(
      sourceShapeQuad.object,
      namedNode('http://www.w3.org/ns/shacl#targetClass'),
      null,
    );
    if (targetClassInShapeQuads.size) {
      const [targetClassInShapeQuad] = targetClassInShapeQuads;
      return targetClassInShapeQuad.object.value;
    }
  }
  // Searching the class of the focus node in the dataset
  const focusNodeQuads = reportDataset.match(
    validationResultNode,
    namedNode('http://www.w3.org/ns/shacl#focusNode'),
    null,
  );
  if (focusNodeQuads.size) {
    const [focusNodeQuad] = focusNodeQuads;
    const focusNodeTypeInDatasetQuads = dataDataset.match(
      focusNodeQuad.object,
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      null,
    );
    // No type of focus node found in validation result as fallback to retrieve targetClass
    if (!focusNodeTypeInDatasetQuads.size) return undefined;
    else {
      const [focusNodeTypeInDatasetQuad] = focusNodeTypeInDatasetQuads;
      return focusNodeTypeInDatasetQuad.object.value;
    }
  } else {
    // No focus node found in validation result as fallback to retrieve targetClass
    return undefined;
  }
}

function getTargetId(validationResultNode, reportDataset, dataDataset) {
  const focusNodeQuads = reportDataset.match(
    validationResultNode,
    namedNode('http://www.w3.org/ns/shacl#focusNode'),
    null,
  );
  // No focus node found
  if (!focusNodeQuads.size) return undefined;
  const [focusNodeQuad] = focusNodeQuads;
  const uuidQuads = dataDataset.match(
    focusNodeQuad.object,
    namedNode('http://mu.semte.ch/vocabularies/core/uuid'),
    null,
  );
  if (uuidQuads.size) {
    const [uuidQuad] = uuidQuads;
    return uuidQuad.object.value;
  } else {
    return undefined;
  }
}

/**
 * Replaces all blank nodes in an N3.Store with generated URIs.
 * @param {Store} store - N3.Store instance
 * @param {string} baseUri - Base URI for generated resources
 * @returns {Store} New store with blank nodes replaced
 */
export function replaceBlankNodes(
  store,
  baseUri = 'http://data.lblod.info/id/.well-known/',
) {
  const newStore = new Store();
  const blankNodeMap = new Map();

  function getOrCreateUri(blankNodeId) {
    if (!blankNodeMap.has(blankNodeId)) {
      const blankNodeUUID = uuid();
      const blankNodeURI = `${baseUri}${blankNodeUUID}`;
      blankNodeMap.set(blankNodeId, namedNode(blankNodeURI));
    }
    return blankNodeMap.get(blankNodeId);
  }

  for (const q of store.match(null, null, null, null)) {
    let subject = q.subject;
    let object = q.object;

    if (subject.termType === 'BlankNode') {
      subject = getOrCreateUri(subject.value);
    }

    if (object.termType === 'BlankNode') {
      object = getOrCreateUri(object.value);
    }

    newStore.addQuad(quad(subject, q.predicate, object, q.graph));
  }

  return newStore;
}

/**
 * Inserts the given dataset into the specified named graphs, requires that the graphs are ext:ownedBy someone
 *
 * @async
 * @function
 * @param { N3.Store } dataset - Store containing the SHACL Report to enrich
 * @param { string[] } namedGraphs - Array of named graphs to save the dataset to
 * @returns { void }
 */
export async function saveDatasetToNamedGraphs(dataset, namedGraphs) {
  const insertBatch = async (batch) => {
    const ttl = await quadsToTtl(batch);
    await updateSudo(`
        PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

        INSERT {
            GRAPH ?g {
                ${ttl}
            }
        } WHERE {
          VALUES ?g {
            ${namedGraphs.map((g) => sparqlEscapeUri(g)).join('\n')}
          }
        }`);
  };
  await handleQuadsInBatch(dataset, INSERT_BATCH_SIZE, insertBatch);
}

async function handleQuadsInBatch(quads, batchSize, callback) {
  let batch = [];
  for (const quad of quads) {
    batch.push(quad);
    if (batch.length >= batchSize) {
      await callback(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await callback(batch);
  }
}

/**
 * Returns string in N-Triples format from N3 Quads.
 *
 * @async
 * @function
 * @param { N3.Quad } quads - Array of N3 Quads to convert to N-Triples format
 * @returns { string } The N-Triples representation of the given quads
 */
async function quadsToTtl(quads) {
  const result = new Promise((resolve, reject) => {
    const writer = new Writer({ format: 'N-Triples' });
    writer.addQuads(quads);
    writer.end((error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
  return result;
}

/**
 * Deletes all SHACL validation reports in the specified named graphs except the most recent one
 *
 * @async
 * @function
 * @param { string[] } namedGraphs - Array of named graphs to delete SHACL validation reports from
 * @returns { void }
 */
export async function deletePreviousShaclValidationReports(namedGraphs) {
  const queryString = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX sh: <http://www.w3.org/ns/shacl#>

    SELECT DISTINCT ?reportUri
    WHERE {
        VALUES ?g {
          ${namedGraphs.map((g) => sparqlEscapeUri(g)).join('\n')}
        }
        GRAPH ?g {
            ?reportUri a sh:ValidationReport ;
                dct:created ?created .
        }
    }
    ORDER BY DESC(?created)
  `;

  const response = await querySudo(queryString);

  if (response.results.bindings.length) {
    response.results.bindings.shift(); // don't remove latest report
    for (const binding of response.results.bindings) {
      await deleteShaclValidationReportInDatabase(
        binding.reportUri.value,
        namedGraphs,
      );
    }
    console.log('All reports deleted');
  }
}

async function deleteShaclValidationReportInDatabase(reportUri, namedGraphs) {
  // done in two parts because single query confuses db because of join result set explosion
  const queryDeleteResults = `
    PREFIX sh: <http://www.w3.org/ns/shacl#>

    DELETE {
      GRAPH ?g {
        ?result ?presult ?oresult .
      }
    }
    WHERE {
      VALUES ?g {
        ${namedGraphs.map((g) => sparqlEscapeUri(g)).join('\n')}
      }
      GRAPH ?g {
        ${sparqlEscapeUri(reportUri)} sh:result ?result .

        ?result ?presult ?oresult .
      }
    }
  `;
  await querySudo(queryDeleteResults);
  const queryString = `
        PREFIX sh: <http://www.w3.org/ns/shacl#>

        DELETE {
          GRAPH ?g {
            ${sparqlEscapeUri(reportUri)} ?preport ?oreport .
          }
        }
        WHERE {
          VALUES ?g {
            ${namedGraphs.map((g) => sparqlEscapeUri(g)).join('\n')}
          }
          GRAPH ?g {
            ${sparqlEscapeUri(reportUri)} ?preport ?oreport .
          }
        }
    `;
  await querySudo(queryString);
}

/**
 * Get SPARQL validation shapes from the given shapes dataset and return an object containing query, message and shape URI for each shape
 *
 * @async
 * @function
 * @param { N3.Store } shapesDataset - N3.Store containing the SHACL shapes to retrieve SPARQL validation shapes from
 * @returns { Object } An object containing query, message en shape URI for each SPARQL validation shape found in the shapes dataset
 */
export async function getSparqlValidationObjects(shapesDataset) {
  const shapes = shapesDataset
    .getSubjects(
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode('http://mu.semte.ch/vocabularies/ext/SparqlShape'),
    )
    .map((subject) => subject.value);
  console.log(`Found ${shapes.length} sparql shapes`);
  const sparqlShapes = {};
  shapes.forEach((shapeSubject) => {
    try {
      const sparql = shapesDataset.getQuads(
        shapeSubject,
        namedNode('http://www.w3.org/ns/shacl#sparql'),
        null,
        null,
      )[0];
      const query = shapesDataset.getQuads(
        sparql.object,
        namedNode('http://www.w3.org/ns/shacl#select'),
        null,
        null,
      )[0].object.value;
      const message = shapesDataset.getQuads(
        sparql.object,
        namedNode('http://www.w3.org/ns/shacl#message'),
        null,
        null,
      )[0].object.value;
      sparqlShapes[shapeSubject] = {
        query: query,
        message: message,
        uri: shapeSubject,
      };
    } catch (e) {
      console.error(
        `Error while processing SPARQL shape ${shapeSubject}: ${e}`,
      );
    }
  });

  return sparqlShapes;
}

/**
 * Runs the shapes with SPARQL queries on the dataset and adds the results to the report dataset.
 *
 * @async
 * @function
 * @param { N3.Store } dataDataset - N3.Store containing the data that is validated
 * @param { N3.Store } reportDataset - N3.Store containing the SHACL validation report to be updated with SPARQL validation results
 * @param { Object[] } sparqlValidationObjects - An array of objects containing the shape URI as key and object as value containing target, message and value keys
 * @returns { void }
 */
export async function addSparqlValidationsToReport(
  dataDataset,
  reportDataset,
  sparqlValidationObjects,
) {
  const graph = await loadDatasetToTempGraph(dataDataset);
  try {
    const results = await runSparqlValidations(graph, sparqlValidationObjects);
    await addShaclResultsToReport(results, reportDataset, dataDataset);
  } catch (e) {
    console.error(`Error while running SPARQL validations: ${e}`);
  }
  await dropTempGraph(graph);
}

async function runSparqlValidations(graph, sparqlValidationObjects) {
  const validationResults = {};
  for (const sparqlValidationObject of Object.values(sparqlValidationObjects)) {
    const insertPos = sparqlValidationObject.query
      .toLowerCase()
      .indexOf('where');
    const query =
      sparqlValidationObject.query.substring(0, insertPos) +
      `FROM <${graph}>\n` +
      sparqlValidationObject.query.substring(insertPos);
    const result = await querySudo(
      query,
      {},
      { sparqlEndpoint: MU_SPARQL_ENDPOINT },
    );
    if (result?.results?.bindings && result.results.bindings.length > 0) {
      validationResults[sparqlValidationObject.uri] = [];
      result.results.bindings.forEach((binding) => {
        validationResults[sparqlValidationObject.uri].push({
          target: binding.this.value,
          value: binding.value?.value,
          message: sparqlValidationObject.message,
        });
      });
    }
  }

  return validationResults;
}

/**
 * Adds validation result objects as SHACL validation results to a SHACL Report.
 *
 * @async
 * @function
 * @param { Object[] } validationResults - Array of objects containing the validation result URI as key, and as value an object with keys target, value, and message
 * @param { N3.Store } reportDataset - N3.Store containing the SHACL validation report to be extended with validation results
 * @param { N3.Store } dataDataset - Store containing the data that is validated
 * @returns { void }
 */
async function addShaclResultsToReport(
  validationResults,
  reportDataset,
  dataDataset,
) {
  const [reportUri] = reportDataset.match(
    null,
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/ns/shacl#ValidationReport'),
    null,
  );

  // When validation results exist and conforms exists with value true, update conforms to false
  if (
    validationResults.length &&
    reportDataset.has(
      reportUri.subject,
      namedNode('http://www.w3.org/ns/shacl#conforms'),
      literal(true),
    )
  ) {
    reportDataset.addQuad(
      reportUri.subject,
      namedNode('http://www.w3.org/ns/shacl#conforms'),
      literal(false),
    );
    reportDataset.removeQuad(
      reportUri.subject,
      namedNode('http://www.w3.org/ns/shacl#conforms'),
      literal(true),
    );
  }

  Object.keys(validationResults).forEach((validationShapeUri) => {
    const results = validationResults[validationShapeUri];
    results.forEach((result) =>
      addResultToReport(
        reportDataset,
        dataDataset,
        reportUri,
        validationShapeUri,
        result,
      ),
    );
  });
}

/**
 * Adds one validation result object as SHACL validation result to a SHACL Report.
 *
 * @function
 * @param { N3.Store } reportDataset - N3.Store containing the SHACL validation report to be extended with validation results
 * @param { N3.Store } dataDataset - Store containing the data that is validated
 * @param { string } reportUri - URI of the SHACL report
 * @param { string } validationUri - URI of the SHACL Property shape
 * @param { Object } result - Object with keys: target, value, and message
 * @returns { void }
 */
function addResultToReport(
  reportDataset,
  dataDataset,
  reportUri,
  validationUri,
  result,
) {
  const id = uuid();
  const resultUri = `http://data.lblod.info/id/validationresults/${id}`;
  const targetClass = dataDataset.match(
    namedNode(result.target),
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    null,
    null,
  );
  if (targetClass.size) {
    const [targetClassQuad] = targetClass;
    reportDataset.add(
      quad(
        namedNode(resultUri),
        namedNode(
          'http://lblod.data.gift/vocabularies/lmb/targetClassOfFocusNode',
        ),
        namedNode(targetClassQuad.object.value),
      ),
    );
  }
  const targetId = dataDataset.match(
    namedNode(result.target),
    namedNode('http://mu.semte.ch/vocabularies/core/uuid'),
    null,
    null,
  );
  if (targetId.size) {
    const [targetIdQuad] = targetId;
    reportDataset.add(
      quad(
        namedNode(resultUri),
        namedNode(
          'http://lblod.data.gift/vocabularies/lmb/targetIdOfFocusNode',
        ),
        literal(targetIdQuad.object.value),
      ),
    );
  }
  reportDataset.add(
    quad(
      reportUri.subject,
      namedNode('http://www.w3.org/ns/shacl#result'),
      namedNode(resultUri),
    ),
  );
  reportDataset.add(
    quad(
      namedNode(resultUri),
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode('http://www.w3.org/ns/shacl#ValidationResult'),
    ),
  );
  reportDataset.add(
    quad(
      namedNode(resultUri),
      namedNode('http://mu.semte.ch/vocabularies/core/uuid'),
      literal(id),
    ),
  );

  if (result.message) {
    reportDataset.add(
      quad(
        namedNode(resultUri),
        namedNode('http://www.w3.org/ns/shacl#resultMessage'),
        literal(result.message),
      ),
    );
  }
  reportDataset.add(
    quad(
      namedNode(resultUri),
      namedNode('http://www.w3.org/ns/shacl#focusNode'),
      namedNode(result.target),
    ),
  );
  reportDataset.add(
    quad(
      namedNode(resultUri),
      namedNode('http://www.w3.org/ns/shacl#sourceShape'),
      namedNode(validationUri),
    ),
  );
  reportDataset.add(
    quad(
      namedNode(resultUri),
      namedNode('http://www.w3.org/ns/shacl#sourceConstraintComponent'),
      namedNode(validationUri),
    ),
  );
  if (result.value) {
    reportDataset.add(
      quad(
        namedNode(resultUri),
        namedNode('http://www.w3.org/ns/shacl#value'),
        literal(result.value),
      ),
    );
  }
  reportDataset.add(
    quad(
      namedNode(resultUri),
      namedNode('http://www.w3.org/ns/shacl#resultSeverity'),
      namedNode('http://www.w3.org/ns/shacl#Error'),
    ),
  );
}

async function dropTempGraph(graph) {
  await querySudo(
    `DROP SILENT GRAPH ${sparqlEscapeUri(graph)}`,
    {},
    { sparqlEndpoint: DIRECT_DATABASE_CONNECTION },
  );
  await querySudo(
    `DELETE DATA {
      GRAPH <http://mu.semte.ch/graphs/public> {
        ${sparqlEscapeUri(graph)} a <http://mu.semte.ch/vocabularies/ext/ValidationWorkingGraph> .
      }
    } `,
    {},
    { sparqlEndpoint: MU_SPARQL_ENDPOINT },
  );
}

async function loadDatasetToTempGraph(dataset) {
  const id = uuid();
  const graph = `http://mu.semte.ch/graphs/temp/validation/${id}`;
  const insertBatch = async (batch) => {
    const ttl = await quadsToTtl(batch);
    await querySudo(
      `INSERT DATA {
      GRAPH ${sparqlEscapeUri(graph)} { ${ttl} }
      GRAPH <http://mu.semte.ch/graphs/public> {
        ${sparqlEscapeUri(graph)} a <http://mu.semte.ch/vocabularies/ext/ValidationWorkingGraph> .
      }
    }`,
      {},
      { sparqlEndpoint: MU_SPARQL_ENDPOINT },
    );
  };
  await handleQuadsInBatch(dataset, INSERT_BATCH_SIZE, insertBatch);

  return graph;
}

/**
 * Runs SPARQL Construct queries on a resource type to retrieve all triples in batches and adds them to the given store
 *
 * @async
 * @function
 * @param { N3.Store } store - N3.Store where the retrieved data will be added to
 * @param { string[] } namedGraphs - Array of named graphs to run the SPARQL Construct queries on
 * @param { string } resources - Array of URIs of the resources to retrieve data for
 * @returns { void }
 */
export async function addResourcesOneLevelDeep(store, namedGraphs, resources) {
  const safeNamedGraphs = namedGraphs
    .map((uri) => sparqlEscapeUri(uri))
    .join('\n');
  const safeResources = resources.map((uri) => sparqlEscapeUri(uri)).join('\n');
  const countFn = async () => {
    const result = await querySudo(`
      SELECT (COUNT(*) AS ?count)
      WHERE {
            VALUES ?graph {
                ${safeNamedGraphs}
            }

            VALUES ?resource {
                ${safeResources}
            }

            GRAPH ?graph {
              ?resource ?pResource ?oResource .
            }
        }
      `);
    if (result.results.bindings.length) {
      return result.results.bindings[0].count.value;
    } else {
      return 0;
    }
  };
  const defaultLimitSize = 1000;

  const queryFn = async (limitSize, offset) => {
    const queryStringConstructOfGraph = `
        CONSTRUCT {
            ?resource ?pResource ?oResource .
        }
        WHERE {
            VALUES ?graph {
                ${safeNamedGraphs}
            }

            VALUES ?resource {
                ${safeResources}
            }

            GRAPH ?graph {
              ?resource ?pResource ?oResource .
            }
        }
        LIMIT ${limitSize}
        OFFSET ${offset}`;

    const queryResponse = await querySudo(queryStringConstructOfGraph);
    await addConstructQueryResponseToStore(store, queryResponse);
  };

  const count = await countFn(resources, namedGraphs);
  const pagesCount =
    count > defaultLimitSize ? Math.ceil(count / defaultLimitSize) : 1;

  for (let page = 0; page < pagesCount; page++) {
    await queryFn(defaultLimitSize, page * defaultLimitSize);
  }
}

/**
 * Counts the number of resources in a set of named graphs
 *
 * @async
 * @function
 * @param { string } targetClass - Type of the resources
 * @param { string[] } namedGraphs - Array of named graphs to run the SPARQL SELECT queries on
 * @returns { integer }
 */
export async function countResources(targetClass, namedGraphs) {
  const safeNamedGraphs = namedGraphs
    .map((uri) => sparqlEscapeUri(uri))
    .join('\n');

  const countResult = await querySudo(`
        SELECT (COUNT(*) AS ?count)
        WHERE {
                VALUES ?graph {
                    ${safeNamedGraphs}
                }

                GRAPH ?graph {
                    ?resource a ${sparqlEscapeUri(targetClass)} .
                }
            }
        `);
  const count = parseInt(countResult.results.bindings[0].count.value);
  console.log(
    `Found ${count} resources of targetClass ${targetClass} in graphs ${safeNamedGraphs}.`,
  );
  return count;
}

export async function getIssuesFromReportId(
  reportId,
  pageSize = 100,
  offset = 0,
) {
  if (!reportId) return [];

  const countFn = async () => {
    const result = await querySudo(`
      PREFIX sh: <http://www.w3.org/ns/shacl#>
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
      PREFIX lmb: <http://lblod.data.gift/vocabularies/lmb/>
      
      SELECT (COUNT(DISTINCT ?result) as ?count)
      WHERE {
        ?report a sh:ValidationReport ;
                mu:uuid ${sparqlEscapeString(reportId)} ;
                sh:result ?result .
      }
      `);
    if (result.results.bindings.length) {
      return result.results.bindings[0].count.value;
    } else {
      return 0;
    }
  };

  const issues = await querySudo(`
    PREFIX sh: <http://www.w3.org/ns/shacl#>
     PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
     PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
     PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
     PREFIX lmb: <http://lblod.data.gift/vocabularies/lmb/>
     
    SELECT ?result ?resultId ?focusNode ?focusNodeId ?resultSeverity ?sourceConstraintComponent ?sourceShape ?resultMessage ?resultPath ?value (GROUP_CONCAT(DISTINCT ?targetClassOfFocusNode; separator=",") AS ?targetClassesOfFocusNode)
    WHERE {
        {
            SELECT DISTINCT ?result ?resultId ?focusNode ?focusNodeId ?resultSeverity ?sourceConstraintComponent ?sourceShape ?resultMessage ?resultPath ?value
            WHERE {
                {
                    select distinct ?result 
                    where {
                    ?report a sh:ValidationReport ;
                            mu:uuid ${sparqlEscapeString(reportId)} ;
                            sh:result ?result .
                    }
                    LIMIT ${pageSize}
                    OFFSET ${offset}
                }
            
                ?result a sh:ValidationResult ;
                        mu:uuid ?resultId ;
                        sh:focusNode ?focusNode ;
                        sh:resultMessage ?resultMessage .

                OPTIONAL {
                  ?focusNode mu:uuid ?focusNodeId .
                }
                
                OPTIONAL {
                    ?result sh:value ?value .
                }
                OPTIONAL {
                    ?result sh:resultSeverity ?resultSeverity .
                }
                OPTIONAL {
                    ?result sh:sourceShape ?sourceShape .
                }
                OPTIONAL {
                    ?result sh:sourceConstraintComponent ?sourceConstraintComponent .
                }
                OPTIONAL {
                    ?result sh:resultPath ?resultPath .
                }
            }
        }
        ?focusNode a ?targetClassOfFocusNode .
    }
    GROUP BY ?result ?resultId ?focusNode ?focusNodeId ?resultSeverity ?sourceConstraintComponent ?sourceShape ?resultMessage ?resultPath ?value
  `);

  if (!issues.results.bindings) {
    throw Error(
      'Er ging iets fout bij het opghalen van de validatie resultaten.',
    );
  }

  const total = await countFn();
  const transformedIssues = issues.results.bindings.map((issue) => {
    return {
      result: issue.result.value,
      resultId: issue.resultId.value,
      focusNode: issue.focusNode.value,
      focusNodeId: issue.focusNodeId?.value,
      resultSeverity: issue.resultSeverity?.value,
      sourceConstraintComponent: issue.sourceConstraintComponent?.value,
      sourceShape: issue.sourceShape?.value,
      resultMessage: issue.resultMessage?.value,
      resultPath: issue.resultPath?.value,
      value: issue.value?.value,
      targetClassOfFocusNode: issue.targetClassesOfFocusNode.value,
    };
  });
  return {
    issues: transformedIssues,
    total: total,
  };
}

export async function getLatestShaclReportId(namedGraphs = []) {
  const graphValues = namedGraphs.length
    ? `VALUES ?g {
          ${namedGraphs.map((g) => sparqlEscapeUri(g)).join('\n')}
        }`
    : '';
  const queryString = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX sh: <http://www.w3.org/ns/shacl#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    SELECT DISTINCT ?reportUuid
    WHERE {
        ${graphValues}
        GRAPH ?g {
            ?reportUri a sh:ValidationReport ;
                mu:uuid ?reportUuid ;
                dct:created ?created .
        }
    }
    ORDER BY DESC(?created)
    LIMIT 1
  `;

  const response = await querySudo(queryString);

  if (response.results.bindings.length) {
    return response.results.bindings[0].reportUuid.value;
  } else {
    return undefined;
  }
}
