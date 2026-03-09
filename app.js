import { app, errorHandler } from 'mu';
import scheduleReportTask from './util/schedule-report-task';
import bodyParser from 'body-parser';
import reports from './config/index';
import { getIssuesFromReportId, getLatestShaclReportId } from './helpers';

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

function parsePagination(req) {
  const pageSize = parseInt(req.query.page?.size ?? 10, 10);
  const pageNumber = parseInt(req.query.page?.number ?? 1, 10);

  if (pageSize <= 0 || pageNumber <= 0) {
    return { error: true };
  }

  const offset = (pageNumber - 1) * pageSize;

  return { pageSize, pageNumber, offset };
}

function buildIssuesResponse(req, issues, total, pageNumber, pageSize) {
  const totalPages = Math.ceil(total / pageSize);
  const last = totalPages > 0 ? totalPages : 1;
  return {
    data: issues.map((issue) => ({
      type: 'validationresult',
      id: String(issue.resultId),
      attributes: { ...issue },
    })),
    meta: {
      total,
      page: pageNumber,
      pageSize,
      totalPages,
    },
    links: {
      self: `${req.baseUrl}${req.path}?page[number]=${pageNumber}&page[size]=${pageSize}`,
      first: `${req.baseUrl}${req.path}?page[number]=1&page[size]=${pageSize}`,
      last: `${req.baseUrl}${req.path}?page[number]=${last}&page[size]=${pageSize}`,
      prev:
        pageNumber > 1
          ? `${req.baseUrl}${req.path}?page[number]=${pageNumber - 1}&page[size]=${pageSize}`
          : null,
      next:
        pageNumber < totalPages
          ? `${req.baseUrl}${req.path}?page[number]=${pageNumber + 1}&page[size]=${pageSize}`
          : null,
    },
  };
}

app.get('/shacl-reports/:id/issues', async (req, res) => {
  try {
    const pagination = parsePagination(req);

    if (pagination.error) {
      return res.status(400).json({
        errors: [
          {
            status: '400',
            title: 'Invalid pagination parameters',
            detail: 'page[size] and page[number] must be positive integers.',
          },
        ],
      });
    }

    const { pageSize, pageNumber, offset } = pagination;

    const reportId =
      req.params.id === 'latest'
        ? await getLatestShaclReportId()
        : req.params.id;

    const { issues, total } = await getIssuesFromReportId(
      reportId,
      pageSize,
      offset,
    );

    res.setHeader('Content-Type', 'application/vnd.api+json');
    res.json(buildIssuesResponse(req, issues, total, pageNumber, pageSize));
  } catch (e) {
    res
      .status(500)
      .setHeader('Content-Type', 'application/vnd.api+json')
      .json({
        errors: [
          {
            status: '500',
            title: 'Internal Server Error',
            detail:
              'Er ging iets fout bij het ophalen van de validatie resultaten.',
          },
        ],
      });
  }
});
