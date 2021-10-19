import cron from 'node-cron';
import sendErrorAlert from './send-error-alert';

export default function scheduleReportTask({cronPattern, name, execute}) {
  if (!name)
    throw 'Report should have a descriptive name.';
  cron.schedule(cronPattern, async () => {
    try {
      await execute();
    } catch (e) {
      sendErrorAlert({
        message: `Something unexpected went wrong while generating report for [${name}].`,
        detail: JSON.stringify(e, undefined, 2)
      });
    }
  });
}
