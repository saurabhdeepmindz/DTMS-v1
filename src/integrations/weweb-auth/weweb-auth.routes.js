import { HTTPException } from 'hono/http-exception';
import databaseService from '../../services/database/database.service.ts';
import { throwDbError } from '../../utils/dbError.js';
import { PublicHTTPException } from '../../core/http.errors.ts';
import betterAuth from './better-auth.js';
import { isDirectoryUser, pickWritableUserData, withoutDirectoryFields } from './userData.ts';

if (process.env.AUTH_SECRET) {
    global.app.on(['POST', 'GET'], '/auth/*', c => {
        // CloudFront sends the viewer host as x-tenant-host; better-auth only reads x-forwarded-host.
        const tenantHost = c.req.header('x-tenant-host');
        if (!tenantHost) return betterAuth.handler(c.req.raw);
        const headers = new Headers(c.req.raw.headers);
        headers.set('x-forwarded-host', tenantHost);
        return betterAuth.handler(new Request(c.req.raw, { headers }));
    });
}

/**
 * Deletes the users matching `filters`, none of them when one is a person of an internal app's company directory:
 * WeWeb syncs them, and their grant is on them. The count deleted.
 */
async function deleteUsers(dbPool, filters) {
    const deleteQuery = databaseService.getDeleteQuery({ schema: 'auth', table: 'users', filters, returnData: true });
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(deleteQuery.query, deleteQuery.params);
        if (rows.some(row => row.directoryStatus)) {
            throw new PublicHTTPException(403, "People of the company directory can't be deleted: WeWeb syncs them", {
                code: 'APP_ACCESS_DIRECTORY_USER',
            });
        }
        await client.query('COMMIT');
        return rows.length;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

global.editor.post('/weweb-auth/:env/select', async c => {
    const env = c.req.param('env');
    const { search = '', limit = 50, offset = 0, sort = [] } = await c.req.json();

    const filters = search
        ? {
              link: '$or',
              conditions: [
                  { field: 'name', operator: '$iLike', value: `%${search}%` },
                  { field: 'email', operator: '$iLike', value: `%${search}%` },
              ],
          }
        : undefined;

    const includes = [
        {
            schema: 'auth',
            table: 'accounts',
            on: { left: 'id', right: 'userId' },
            alias: 'providers',
            many: true,
        },
    ];

    // Include all physical columns of auth.users (system + custom) and the providers virtual column
    const columns = {
        '*': true,
        providers: { $mode: 'array', field: 'providerId' },
    };

    const usersQuery = databaseService.getSelectQuery({
        schema: 'auth',
        table: 'users',
        columns,
        filters,
        sort,
        limit,
        offset,
        includes,
    });

    const countQuery = databaseService.getCountQuery({
        schema: 'auth',
        table: 'users',
        filters,
        includes,
    });

    const [usersResult, countResult] = await Promise.all([
        databaseService.execute({ ...usersQuery, env }),
        databaseService.execute({ ...countQuery, env }),
    ]);

    return c.json({
        data: usersResult,
        metadata: {
            total: parseInt(countResult[0].count),
            limit,
            offset,
        },
    });
});

global.editor.post('/weweb-auth/:env', async c => {
    const env = c.req.param('env');
    const body = await c.req.json();

    const dbPool = databaseService.getPool(env);
    if (!dbPool) throw new HTTPException(400, { message: 'Database is not configured in this environment' });

    const { email, password } = body;

    try {
        const ctx = await betterAuth.$context;
        const hashedPassword = await ctx.password.hash(password);

        const userData = {
            ...pickWritableUserData(body),
            email: email.toLowerCase(),
            name: body.name || email.split('@')[0],
            image: body.image || null,
            emailVerified: body.emailVerified ?? false,
        };

        const insertUserQuery = databaseService.getInsertQuery({
            schema: 'auth',
            table: 'users',
            data: userData,
            returnData: true,
        });

        const userResult = await databaseService.execute({
            query: insertUserQuery.query,
            params: insertUserQuery.params,
            env,
        });

        if (userResult.length === 0) {
            throw new Error('Failed to create user');
        }

        const userId = userResult[0].id;

        // Create account entry in auth.accounts table
        // For credential accounts, accountId equals userId (as text)
        const accountData = {
            userId: userId,
            accountId: String(userId), // accountId is text type
            providerId: 'credential',
            password: hashedPassword,
        };

        const insertAccountQuery = databaseService.getInsertQuery({
            schema: 'auth',
            table: 'accounts',
            data: accountData,
            returnData: false,
        });

        await databaseService.execute({
            query: insertAccountQuery.query,
            params: insertAccountQuery.params,
            env,
        });

        return c.json(
            {
                message: 'User created successfully',
                user: userResult[0],
            },
            201
        );
    } catch (error) {
        console.error('Error creating user:', error);

        if (error.message?.includes('already exists') || (error.code === '23505' && error.constraint === 'users_email_key')) {
            throw new HTTPException(409, { message: 'User with this email already exists' });
        }

        throw new HTTPException(500, { message: 'Failed to create user' });
    }
});

global.editor.get('/weweb-auth/:env/:userId', async c => {
    const env = c.req.param('env');
    const userId = c.req.param('userId');

    const dbPool = databaseService.getPool(env);
    if (!dbPool) throw new HTTPException(400, { message: 'Database is not configured in this environment' });

    const userQuery = databaseService.getSelectQuery({
        schema: 'auth',
        table: 'users',
        filters: {
            link: '$and',
            conditions: [{ field: 'id', operator: '$eq', value: userId }],
        },
    });

    const result = await dbPool.query(userQuery.query, userQuery.params);

    if (result.rows.length === 0) {
        throw new HTTPException(404, { message: 'User not found' });
    }

    return c.json({ user: result.rows[0] });
});

global.editor.patch('/weweb-auth/:env/:userId', async c => {
    const env = c.req.param('env');
    const userId = c.req.param('userId');
    const body = await c.req.json();

    const dbPool = databaseService.getPool(env);
    if (!dbPool) throw new HTTPException(400, { message: 'Database is not configured in this environment' });

    // A person of the company directory keeps what it says of them: WeWeb syncs it.
    const updateData = {
        updatedAt: new Date(),
        ...withoutDirectoryFields(pickWritableUserData(body), await isDirectoryUser(dbPool, userId)),
    };

    const updateQuery = databaseService.getUpdateQuery({
        schema: 'auth',
        table: 'users',
        data: updateData,
        filters: {
            link: '$and',
            conditions: [{ field: 'id', operator: '$eq', value: userId }],
        },
        returnData: true,
    });

    const result = await dbPool.query(updateQuery.query, updateQuery.params);

    if (result.rows.length === 0) {
        throw new HTTPException(404, { message: 'User not found' });
    }

    return c.json({
        message: 'User updated successfully',
        user: result.rows[0],
    });
});

global.editor.delete('/weweb-auth/:env/:userId', async c => {
    try {
        const env = c.req.param('env');
        const userId = c.req.param('userId');

        const dbPool = databaseService.getPool(env);
        if (!dbPool) throw new HTTPException(400, { message: 'Database is not configured in this environment' });

        await deleteUsers(dbPool, {
            link: '$and',
            conditions: [{ field: 'id', operator: '$eq', value: userId }],
        });

        return c.json({
            message: 'User deleted successfully',
            deletedUserId: userId,
        });
    } catch (err) {
        throwDbError(err);
    }
});

global.editor.post('/weweb-auth/:env/update', async c => {
    try {
        const env = c.req.param('env');
        const { data, filters } = await c.req.json();

        if (!data || !filters) {
            throw new HTTPException(400, { message: 'data and filters are required' });
        }

        const dbPool = databaseService.getPool(env);
        if (!dbPool) throw new HTTPException(400, { message: 'Database is not configured in this environment' });

        // An internal app's users are its company directory's people: what it says of them stays.
        const updateData = {
            updatedAt: new Date(),
            ...withoutDirectoryFields(pickWritableUserData(data), await isDirectoryUser(dbPool)),
        };

        const updateQuery = databaseService.getUpdateQuery({
            schema: 'auth',
            table: 'users',
            data: updateData,
            filters,
        });

        const result = await dbPool.query(updateQuery.query, updateQuery.params);

        if (result.rows.length === 0) {
            throw new HTTPException(404, { message: 'User not found' });
        }

        return c.json({
            message: 'User updated successfully',
            user: result.rows[0],
        });
    } catch (err) {
        throwDbError(err);
    }
});

global.editor.post('/weweb-auth/:env/delete', async c => {
    try {
        const env = c.req.param('env');
        const { filters } = await c.req.json();

        if (!filters) {
            throw new HTTPException(400, { message: 'filters is required' });
        }

        const dbPool = databaseService.getPool(env);
        if (!dbPool) throw new HTTPException(400, { message: 'Database is not configured in this environment' });

        return c.json({
            message: 'Users deleted successfully',
            deletedCount: await deleteUsers(dbPool, filters),
        });
    } catch (err) {
        throwDbError(err);
    }
});
