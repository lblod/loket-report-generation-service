import { app, errorHandler } from 'mu';
import cron from 'node-cron';
import reports from './reports/index';


reports.forEach(({cronPattern, execute}) => {
  if(cronPattern) {
    try {
      cron.schedule(cronPattern, execute);
    }catch(e){
      console.log(e);
    }
  }
});

app.post('/reports', async (req, res) => {
  const reportName = req.body.name;
  if(reportName) {
    let report = reports.find((report) => report.name === reportName);
    if(report) {
      await report.execute();
      return res.json({
        data: {
          type: 'result',
          id: 1,
          attributes: {
            label: 'success'
          }
        }
      });
    } else {
      res.status(404);
      return res.json({
        data: {
          type: 'result',
          id: 2,
          attributes: {
            label: 'error',
            info: `There's no report named ${reportName}`
          }
        }
      });
    }
  }else {
    res.status(400);
    return res.json({
      data: {
        type: 'result',
        id: 2,
        attributes: {
          label: 'error',
          info: 'No report name specified in the request'
        }
      }
    });
  }
});

app.get('/test', async (req, res) => {
  res.send('Hello World');
});

app.use(errorHandler);
