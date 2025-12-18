#!/bin/bash
set -e

# Wait for PostgreSQL to be ready
sleep 2

# Read application user password from secrets
APP_USER_PASSWORD=$(cat /run/secrets/db_app_password)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Crie o usuário de app se não existir (idempotente)
    DO
    \$\$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER}') THEN
            CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_USER_PASSWORD}';
        END IF;
    END
    \$\$;

    -- Crie o schema (propriedade do admin)
    CREATE SCHEMA IF NOT EXISTS app_schema;

    -- Crie a tabela exemplo (como admin)
    CREATE TABLE IF NOT EXISTS app_schema.users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Só agora transfira o ownership do schema e das tabelas pra appuser
    ALTER SCHEMA app_schema OWNER TO ${APP_DB_USER};
    ALTER TABLE app_schema.users OWNER TO ${APP_DB_USER};

    -- GRANTs & ajustes de permissões finais
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
    GRANT USAGE ON SCHEMA app_schema TO ${APP_DB_USER};
    GRANT CREATE ON SCHEMA app_schema TO ${APP_DB_USER};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_schema TO ${APP_DB_USER};
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA app_schema TO ${APP_DB_USER};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_schema TO ${APP_DB_USER};

    -- Ajuste do search_path do appuser para facil acesso
    ALTER USER ${APP_DB_USER} SET search_path TO app_schema, public;

    -- Só o admin pode acessar o banco, revoga tudo do PUBLIC
    REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;

    -- Admin não será superuser (melhor prática para dev/prod)
    ALTER USER ${POSTGRES_USER} WITH NOSUPERUSER;
EOSQL

echo "Database initialization complete!"