# Todo

Make expiration strategy backend specific. Redis is gonna work differently than local memory, or a DB as far as expirations go.

Make backends in different projects. Someone who just wants memory wont need redis as a dependency.