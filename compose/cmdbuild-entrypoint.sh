#!/bin/sh
set -eu

POSTGRES_PASSWORD=$(cat /run/secrets/cmdbuild_db_password)
CMDBUILD_APP_PASSWORD=$(cat /run/secrets/cmdbuild_app_password)
export POSTGRES_PASSWORD
export CMDBUILD_APP_PASSWORD

# Docker secrets are root-readable; CMDBuild itself rejects a root web process.
# This isolated volume may have been initialized by the bootstrap wrapper, so
# normalize ownership before dropping privileges for Tomcat.
chown -R tomcat:tomcat /usr/local/tomcat

database_conf="$CATALINA_HOME/conf/cmdbuild/database.conf"
database_conf_tmp="$database_conf.tmp"
install -o tomcat -g tomcat -m 0600 /dev/null "$database_conf_tmp"
{
  echo "db.url=jdbc:postgresql://${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  echo "db.username=cmdbuild"
  echo "db.password=${CMDBUILD_APP_PASSWORD}"
  echo "db.admin.username=${POSTGRES_USER}"
  echo "db.admin.password=${POSTGRES_PASSWORD}"
} >> "$database_conf_tmp"
mv -f "$database_conf_tmp" "$database_conf"
test "$(stat -c '%a:%U:%G' "$database_conf")" = '600:tomcat:tomcat'

while ! timeout 1 bash -c "echo > /dev/tcp/${POSTGRES_HOST}/${POSTGRES_PORT}"; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep 5
done

CMDBUILD_DUMP_PATH="$CMDBUILD_DUMP"
case "$CMDBUILD_DUMP_PATH" in
  /*) ;;
  *) CMDBUILD_DUMP_PATH="$CATALINA_HOME/webapps/cmdbuild/WEB-INF/sql/dump/$CMDBUILD_DUMP_PATH" ;;
esac
test -r "$CMDBUILD_DUMP_PATH"
"$CATALINA_HOME/webapps/cmdbuild/cmdbuild.sh" dbconfig create "$CMDBUILD_DUMP_PATH" -configfile "$database_conf" || true
exec setpriv --reuid=tomcat --regid=tomcat --init-groups --inh-caps=-all "$CATALINA_HOME/bin/catalina.sh" run
