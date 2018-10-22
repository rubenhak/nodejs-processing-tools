const LEVELS = [
    'info',
    'warn',
    'error',
    'crit',
    'verbose',
    'debug',
    'silly'
]

var logger = {

}

for(var x of LEVELS) {
    logger[x] = function() {
        console.log(arguments)
    }
}

logger['sublogger'] = function() {
    return logger;
}

module.exports = logger;