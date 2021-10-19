import { uuid, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime } from 'mu';
import { updateSudo as update } from '@lblod/mu-auth-sudo';
import { CREATOR } from '../config';

export default async function sendErrorAlert({message, detail, reference}) {
  if (!message) {
    throw 'ErrorAlert needs at least a message describing what went wrong.';
  }

  const id = uuid();
  const uri = `http://data.lblod.info/errors/${id}`;
  const optionalReferenceTriple = reference ? `${sparqlEscapeUri(uri)} dct:references ${sparqlEscapeUri(reference)} .` : '';
  const optionalDetailTriple = detail ? `${sparqlEscapeUri(uri)} oslc:largePreview ${sparqlEscapeString(detail)} .` : '';

  const createErrorAlertQuery = `
      PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
      PREFIX oslc: <http://open-services.net/ns/core#>
      PREFIX dct:  <http://purl.org/dc/terms/>

      INSERT DATA {
        GRAPH <http://mu.semte.ch/graphs/error> {
            ${sparqlEscapeUri(uri)} a oslc:Error ;
                    mu:uuid ${sparqlEscapeString(id)} ;
                    dct:subject ${sparqlEscapeString('Report Generation Service')} ;
                    oslc:message ${sparqlEscapeString(message)} ;
                    dct:created ${sparqlEscapeDateTime(new Date().toISOString())} ;
                    dct:creator ${sparqlEscapeUri(CREATOR)} .

            ${optionalReferenceTriple}
            ${optionalDetailTriple}
        }
      }
    `;

  try {
    await update(createErrorAlertQuery);
    console.log(`Successfully sent out an error-alert.\nMessage: ${message}`);
  } catch (e) {
    console.warn(`[WARN] Something went wrong while trying to store an error-alert.\nMessage: ${e}\nQuery: ${createErrorAlertQuery}`);
  }
}
