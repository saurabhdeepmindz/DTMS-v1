import databaseService from '../../services/database/database.service.ts';
import betterAuth from './better-auth.js';
import { isDirectoryUser, pickWritableUserData, withoutDirectoryFields } from './userData.ts';

global.registerAction('weweb-auth/user-create', async ({ args }, context) => {
    const { email, password } = args;

    if (!email) throw new Error('Email is required to create a user');
    if (!password) throw new Error('Password is required to create a user');

    const ctx = await betterAuth.$context;
    const hashedPassword = await ctx.password.hash(password);

    const userData = {
        ...pickWritableUserData(args),
        email: email.toLowerCase(),
        name: args.name || email.split('@')[0],
        image: args.image || null,
        emailVerified: args.emailVerified || false,
        roles: args.roles || null,
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
        currentUser: context.auth?.user,
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
        currentUser: context.auth?.user,
    });

    return userResult[0];
});

global.registerAction('weweb-auth/user-update', async ({ args }, context) => {
    const { userId } = args;

    if (!userId) throw new Error('User ID is required to update a user');

    const ctx = await betterAuth.$context;
    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user) {
        throw new Error(`User with ID "${userId}" not found`);
    }

    // A person of the company directory keeps what it says of them: WeWeb syncs it.
    const updateData = withoutDirectoryFields(
        pickWritableUserData(args),
        await isDirectoryUser(databaseService.pool, userId)
    );

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

    const result = await databaseService.execute({
        query: updateQuery.query,
        params: updateQuery.params,
        currentUser: context.auth?.user,
    });

    return result[0];
});

global.registerAction('weweb-auth/user-update-password', async ({ args }, context) => {
    const { userId, password } = args;

    if (!userId) throw new Error('User ID is required to update password');
    if (!password) throw new Error('Password is required to update password');

    const ctx = await betterAuth.$context;

    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user) {
        throw new Error(`User with ID "${userId}" not found`);
    }

    const hashedPassword = await ctx.password.hash(password);

    const updateQuery = databaseService.getUpdateQuery({
        schema: 'auth',
        table: 'accounts',
        data: {
            password: hashedPassword,
        },
        filters: {
            link: '$and',
            conditions: [
                { field: 'userId', operator: '$eq', value: userId },
                { field: 'providerId', operator: '$eq', value: 'credential' },
            ],
        },
        returnData: true,
    });

    const result = await databaseService.execute({
        query: updateQuery.query,
        params: updateQuery.params,
        currentUser: context.auth?.user,
    });

    if (result.length === 0) {
        throw new Error(`Account with user ID "${userId}" and provider "credential" not found`);
    }

    return 'Password updated successfully';
});

global.registerAction('weweb-auth/user-delete', async ({ args }, context) => {
    const { userId } = args;

    if (!userId) throw new Error('User ID is required to delete a user');

    const ctx = await betterAuth.$context;
    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user) {
        throw new Error(`User with ID "${userId}" not found`);
    }
    // WeWeb syncs the people of the company directory, and their access is on them.
    if (await isDirectoryUser(databaseService.pool, userId)) {
        throw new Error("People of the company directory can't be deleted: WeWeb syncs them");
    }

    const deleteQuery = databaseService.getDeleteQuery({
        schema: 'auth',
        table: 'users',
        filters: {
            link: '$and',
            conditions: [{ field: 'id', operator: '$eq', value: userId }],
        },
    });

    await databaseService.execute({
        query: deleteQuery.query,
        params: deleteQuery.params,
        currentUser: context.auth?.user,
    });

    return 'User deleted successfully';
});
