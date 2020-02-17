import { app, errorHandler } from 'mu';
import cron from 'node-cron'
import reports from './reports/index'


reports.forEach(({cronPattern, execute}) => {
cron.schedule(cronPattern, execute)
})

app.get('/reports', async (req, res) => {
  const reportName = req.query.name
  if(reportName) {
    let reportFound = false
    for(let i = 0; i< reports.length; i++) {
      const {name, execute} = reports[i]
      if(reportName === name) {
        reportFound = true
        await execute()
        res.send('Done ^^')
        return
      }
    }
    if(!reportFound) {
      return res.send(`There's no report named ${reportName}`)
    }
  }else {
    return res.send('No report name')
  }
})

app.get('/test', async (req, res) => {
  res.send('Hello World')
})






app.use(errorHandler);
