# ClassPulse backup and restore runbook

The scheduled workflow in `.github/workflows/database-backup.yml` creates a daily encrypted export of database roles, schema, and data. It does not contain Supabase Storage object contents; school-logo files must be backed up separately if Storage is used for irreplaceable files.

## Required GitHub secrets

- `SUPABASE_DB_URL`: the production direct database connection string from Supabase.
- `BACKUP_PASSPHRASE`: a randomly generated passphrase of at least 24 characters. Keep an offline copy outside GitHub; a backup cannot be recovered without it.
- `SUPABASE_FUNCTIONS_URL` and `RELIABILITY_CRON_SECRET`: used by the five-minute reliability worker workflow.

After configuring the secrets, manually run both workflows once and confirm that the reliability request succeeds and the encrypted backup artifact is downloadable.

## Verify and decrypt an artifact

1. Verify the downloaded checksum with `sha256sum -c classpulse-database.tar.gz.gpg.sha256`.
2. Decrypt with `gpg --output classpulse-database.tar.gz --decrypt classpulse-database.tar.gz.gpg`.
3. Extract the archive and confirm `roles.sql`, `schema.sql`, `data.sql`, and `manifest.txt` are present and non-empty.

## Restore testing

Restore only into an empty, isolated Supabase test project. Apply roles, schema, and data in that order, then run the database security regression suite and application smoke tests. Never test a restore over the production database.

