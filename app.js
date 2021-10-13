import { app, errorHandler } from 'mu';
import scheduleReportTask, { reportTaskMap } from './util/schedule-report-task';
import bodyParser from 'body-parser';
import reports from './reports/index';

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));

// parse application/json
app.use(bodyParser.json());

// schedule report tasks
try {
  reports.forEach((report) => {
    if (report.cronPattern)
      scheduleReportTask(report);
  });
} catch (e) {
  console.warn(`Something went wrong while scheduling report tasks.\nMessage: ${e}`);
}

app.post('/reports', async (req, res) => {
  const reportName = req.body.data.attributes.reportName;
  if (reportName) {
    let report = reports.find((report) => report.name === reportName);
    if (report) {
      report.execute();
      return res.json({
        data: {
          type: 'report-generation-tasks',
          attributes: {
            status: 'success'
          }
        }
      });
    } else {
      res.status(404);
      return res.json({
        data: {
          type: 'report-generation-tasks',
          attributes: {
            status: 'error',
            info: `There's no report named ${reportName}`
          }
        }
      });
    }
  } else {
    res.status(400);
    return res.json({
      data: {
        type: 'report-generation-tasks',
        attributes: {
          status: 'error',
          info: 'No report name specified in the request'
        }
      }
    });
  }
});

app.get('/', async (req, res) => {
  res.send('Hello World');
});

app.use(errorHandler);
