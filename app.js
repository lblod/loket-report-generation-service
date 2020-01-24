import { app, errorHandler } from 'mu';
import cron from 'node-cron'
import berichtencentrumMessagesReport from './reports/berichtencentrumMessages'
import reports from './reports/index'


const DEFAULT_GRAPH = process.env.DEFAULT_GRAPH || 'http://mu.semte.ch/application';

app.get('/test', async (req, res) => {
  await berichtencentrumMessagesReport()  
  res.send('Done ^^')
})

reports.forEach(({cronPattern, execute}) => {
  cron.schedule(cronPattern, execute)
})

app.get('/reports', async (req, res) => {
  const reportName = req.query.name
  if(reportName) {
    reports.forEach(async ({name, execute}) => {
      if(reportName === name) {
        await execute()
        res.send('Done ^^')
        return
      }
    })
  }else {
    res.send('No report name')
  }
})

app.use(errorHandler);
