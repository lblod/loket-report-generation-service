# Report Generation Service
The report generation service provides a way of generating reports from the data represented in your virtuoso database, as well as, a set of helpers for this purpose.

## Add the service to your stack

```yaml
reportService:
    image: lblod/loket-report-generation-service:0.0.1
    links:
      - database:database
    volumes:
      - ./data/files:/data/files
      - ./data/reports:/app/reports
```

## Defining reports
In order to define a report you have to create a file in
