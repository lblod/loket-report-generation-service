import { app, errorHandler } from 'mu';
import cron from 'node-cron'

try {
  const reports = require('./reports/index.mjs')
  reports.forEach(({cronPattern, execute}) => {
    cron.schedule(cronPattern, execute)
  })
  app.get('/reports', async (req, res) => {
    const reportName = req.query.name
    if(reportName) {
      let reportFound = false
      await Promise.all(reports.forEach(async ({name, execute}) => {
        if(reportName === name) {
          reportFound = true
          await execute()
          res.send('Done ^^')
          return
        }
      }))
      if(!reportFound) {
        return res.send(`There's no report named ${reportName}`)
      }
    }else {
      return res.send('No report name')
    }
  })
} catch(e) {
  app.get('/reports', (req, res) => {
    console.log('no reports executed')
    res.send('No reports found')
  })
}

app.get('/test', async (req, res) => {
  res.send('Hello World')
})






app.use(errorHandler);
