import { app, errorHandler } from 'mu';
import scheduleReportTask from './util/schedule-report-task';
import bodyParser from 'body-parser';
import reports from './config/index';
import { sparqlEscapeString, query } from 'mu';

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

// schedule report tasks
try {
  reports.forEach((report) => {
    if (report.cronPattern) scheduleReportTask(report);
  });
} catch (e) {
  console.warn(
    `Something went wrong while scheduling report tasks.\nMessage: ${e}`,
  );
}

app.post('/reports', async (req, res, next) => {
  try {
    const reportName = req.body.data.attributes.reportName;
    if (reportName) {
      let report = reports.find((report) => report.name === reportName);
      if (report) {
        await report.execute();
        return res.json({
          data: {
            type: 'report-generation-tasks',
            attributes: {
              status: 'success',
            },
          },
        });
      } else {
        res.status(404);
        return res.json({
          data: {
            type: 'report-generation-tasks',
            attributes: {
              status: 'error',
              info: `There's no report named ${reportName}`,
            },
          },
        });
      }
    } else {
      res.status(400);
      return res.json({
        data: {
          type: 'report-generation-tasks',
          attributes: {
            status: 'error',
            info: 'No report name specified in the request',
          },
        },
      });
    }
  } catch (e) {
    next(e);
  }
});

app.get('/', async (req, res) => {
  res.send('Hello World');
});

app.use(errorHandler);

app.get('/shacl-reports/:id/issues', async (req, res) => {
  const reportId = req.params.id;

  const issues = await query(`
    PREFIX sh: <http://www.w3.org/ns/shacl#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
    PREFIX lmb: <http://lblod.data.gift/vocabularies/lmb/>
    
    SELECT DISTINCT ?result ?focusNode ?focusNodeId ?resultSeverity ?sourceConstraintComponent ?sourceShape ?resultMessage ?resultPath ?value ?targetClassOfFocusNode
    WHERE {
      ?report a sh:ValidationReport ;
              mu:uuid ${sparqlEscapeString(reportId)} ;
              sh:result ?result .

      ?result a sh:ValidationResult ;
              sh:focusNode ?focusNode .
      OPTIONAL {
        ?focusNode mu:uuid ?focusNodeId .
      }
      OPTIONAL {
        ?focusNode a ?targetClassOfFocusNode .
      }
      OPTIONAL {
        ?result sh:resultMessage ?resultMessage .
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
        ?result sh:value ?value .
      }
      OPTIONAL {
        ?result sh:resultPath ?resultPath .
      }
    }
  `);

  if (!issues.results.bindings) {
    res
      .status(500)
      .send('Er ging iets fout bij het opghalen van de validatie resultaten.');
    return;
  }
  const transformedIssues = issues.results.bindings.map((issue) => {
    return {
      result: issue.result.value,
      focusNode: issue.focusNode.value,
      focusNodeId: issue.focusNodeId?.value,
      resultSeverity: issue.resultSeverity?.value,
      sourceConstraintComponent: issue.sourceConstraintComponent?.value,
      sourceShape: issue.sourceShape?.value,
      resultMessage: issue.resultMessage?.value,
      resultPath: issue.resultPath?.value,
      value: issue.value?.value,
      targetClassOfFocusNode: issue.targetClassOfFocusNode.value,
    };
  });
  res.json(transformedIssues);
});