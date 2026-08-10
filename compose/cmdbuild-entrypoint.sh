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

cat /dev/null > "$CATALINA_HOME/conf/cmdbuild/database.conf"
{
  echo "db.url=jdbc:postgresql://${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  echo "db.username=cmdbuild"
  echo "db.password=${CMDBUILD_APP_PASSWORD}"
  echo "db.admin.username=${POSTGRES_USER}"
  echo "db.admin.password=${POSTGRES_PASSWORD}"
} >> "$CATALINA_HOME/conf/cmdbuild/database.conf"

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
"$CATALINA_HOME/webapps/cmdbuild/cmdbuild.sh" dbconfig create "$CMDBUILD_DUMP_PATH" -configfile "$CATALINA_HOME/conf/cmdbuild/database.conf" || true
exec setpriv --reuid=tomcat --regid=tomcat --init-groups --inh-caps=-all "$CATALINA_HOME/bin/catalina.sh" run
