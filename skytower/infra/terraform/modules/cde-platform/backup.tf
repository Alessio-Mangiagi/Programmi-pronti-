# "><(((º> sabusabu <º)))><"
# AWS Backup: snapshot giornalieri e mensili del database, copiati nella regione DR (se enable_dr).
# Si aggiungono al PITR di RDS (35 gg, RPO ~5') e servono per ripristini oltre la finestra PITR
# o con la regione primaria non disponibile. Vault lock: nessuno può cancellare i recovery point.

resource "aws_backup_vault" "main" {
  name        = "${local.prefix}-backup"
  kms_key_arn = module.kms_data.key_arn
}

resource "aws_backup_vault" "dr" {
  count       = local.dr
  provider    = aws.dr
  name        = "${local.prefix}-backup-dr"
  kms_key_arn = module.kms_dr[0].key_arn
}

resource "aws_backup_vault_lock_configuration" "main" {
  backup_vault_name   = aws_backup_vault.main.name
  min_retention_days  = 35
  max_retention_days  = 3650
  changeable_for_days = 3 # dopo 3 giorni il lock diventa immutabile (modalità compliance)
}

resource "aws_backup_vault_lock_configuration" "dr" {
  count               = local.dr
  provider            = aws.dr
  backup_vault_name   = aws_backup_vault.dr[0].name
  min_retention_days  = 35
  max_retention_days  = 3650
  changeable_for_days = 3
}

resource "aws_backup_plan" "db" {
  name = "${local.prefix}-db"

  rule {
    rule_name         = "giornaliero"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 2 * * ? *)"
    start_window      = 60
    completion_window = 240

    lifecycle {
      delete_after = 35
    }

    dynamic "copy_action" {
      for_each = aws_backup_vault.dr
      content {
        destination_vault_arn = copy_action.value.arn
        lifecycle {
          delete_after = 35
        }
      }
    }
  }

  rule {
    rule_name         = "mensile"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 3 1 * ? *)"
    start_window      = 60
    completion_window = 480

    lifecycle {
      cold_storage_after = 90
      delete_after       = 3650 # 10 anni, come la retention dei documenti
    }

    dynamic "copy_action" {
      for_each = aws_backup_vault.dr
      content {
        destination_vault_arn = copy_action.value.arn
        lifecycle {
          cold_storage_after = 90
          delete_after       = 3650
        }
      }
    }
  }
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${local.prefix}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "db" {
  name         = "${local.prefix}-db"
  plan_id      = aws_backup_plan.db.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [module.db.db_instance_arn]
}
