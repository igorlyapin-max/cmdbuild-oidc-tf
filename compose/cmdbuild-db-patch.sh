#!/bin/sh
set -eu

POSTGRES_PASSWORD=$(cat /run/secrets/cmdbuild_db_password)
CMDBUILD_APP_PASSWORD=$(cat /run/secrets/cmdbuild_app_password)
export POSTGRES_PASSWORD
export CMDBUILD_APP_PASSWORD

chown -R tomcat:tomcat /usr/local/tomcat
cat /dev/null > "$CATALINA_HOME/conf/cmdbuild/database.conf"
{
  echo "db.url=jdbc:postgresql://${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  echo "db.username=cmdbuild"
  echo "db.password=${CMDBUILD_APP_PASSWORD}"
  echo "db.admin.username=${POSTGRES_USER}"
  echo "db.admin.password=${POSTGRES_PASSWORD}"
} >> "$CATALINA_HOME/conf/cmdbuild/database.conf"

exec setpriv --reuid=tomcat --regid=tomcat --init-groups --inh-caps=-all "$CATALINA_HOME/webapps/cmdbuild/cmdbuild.sh" dbconfig patch -configfile "$CATALINA_HOME/conf/cmdbuild/database.conf"
