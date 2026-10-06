#!/bin/sh
# Copia ./backups fuori dal server (sul server, dalla cartella del repo).
# Senza copia esterna un guasto del disco porta via dati E backup insieme.
#
#   sh scripts/backup_offsite.sh /mnt/nas/incampo        # cartella montata (NAS, altro disco)
#   sh scripts/backup_offsite.sh s3remoto:bucket/incampo  # remote rclone già configurato (rclone config)
#
# Da pianificare dopo il backup notturno (alle 2), es. crontab -e:
#   30 3 * * * cd /opt/incampo && sh scripts/backup_offsite.sh /mnt/nas/incampo >> backups/offsite.log 2>&1
#
# Copia solo (non cancella nulla a destinazione): la rotazione esterna si decide lì.
# Esce con errore se l'ultimo dump ha più di 26 ore: il backup notturno non sta girando.
set -e
DEST="$1"
SRC="${BACKUP_DIR:-./backups}"
if [ -z "$DEST" ]; then
  echo "uso: sh scripts/backup_offsite.sh <cartella | remote:percorso>" >&2
  exit 2
fi
LATEST=$(find "$SRC" -name 'db-*.sql.gz' -mmin -1560 | head -1)
if [ -z "$LATEST" ]; then
  echo "$(date -Iseconds) ERRORE: nessun dump recente in $SRC (backup notturno fermo?)" >&2
  exit 1
fi
case "$DEST" in
  /*|./*|../*)
    mkdir -p "$DEST"
    cp -p -u "$SRC"/db-*.sql.gz "$SRC"/storage-*.tgz "$DEST"/ 2>/dev/null || cp -p -u "$SRC"/db-*.sql.gz "$DEST"/
    ;;
  *:*)
    command -v rclone >/dev/null || { echo "serve rclone per $DEST" >&2; exit 1; }
    rclone copy "$SRC" "$DEST" --include 'db-*.sql.gz' --include 'storage-*.tgz'
    ;;
  *)
    echo "destinazione non riconosciuta: usa un percorso assoluto o remote:percorso" >&2
    exit 2
    ;;
esac
echo "$(date -Iseconds) copia esterna ok -> $DEST (ultimo dump: $(basename "$LATEST"))"
