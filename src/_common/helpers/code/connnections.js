export function resolveConnection(connection, env = null) {
    if (!connection) return null;

    const resolvedConnection = JSON.parse(JSON.stringify(connection));

 
    for (const key in resolvedConnection?.config || {}) {
        if (resolvedConnection.config[key]?.__envVariableKey) {
            resolvedConnection.config[key] =
                wwLib.globalContext?.env?.[resolvedConnection.config[key].__envVariableKey];
        }
    }
    return resolvedConnection;
}
