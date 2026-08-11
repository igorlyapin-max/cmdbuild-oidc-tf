#!/bin/sh
set -eu

POSTGRES_PASSWORD=$(cat /run/secrets/cmdbuild_db_password)
CMDBUILD_APP_PASSWORD=$(cat /run/secrets/cmdbuild_app_password)
export POSTGRES_PASSWORD
export CMDBUILD_APP_PASSWORD

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

exec setpriv --reuid=tomcat --regid=tomcat --init-groups --inh-caps=-all "$CATALINA_HOME/webapps/cmdbuild/cmdbuild.sh" dbconfig patch -configfile "$database_conf"
