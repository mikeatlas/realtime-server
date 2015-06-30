module.exports = {
    
    loadSocketIo: function loadSocketIo(redis) {

        var port = process.env.PORT || 5001;
        if (process.env.NODE_ENV != 'production') {
            port = 5001; // run on a different port when in non-production mode.
        }

        console.log('STARTING ON PORT: ' + port);

        var io = require('socket.io').listen(Number(port));

        io.on('connection', function(socket) {

            socket.on('realtime_user_id_connected', function(message) {
                console.log('Realtime User ID connected: ' + message.userId);
            });

            socket.on('disconnect',function(){
                redis.sub.removeListener('message', onMessage); 
            });

            redis.sub.on('message', onMessage);

            function onMessage(channel, message){
                // can't deliver a message to a socket with no handshake(session) established
                if (socket.request === undefined) {
                    return;
                }

                msg = JSON.parse(message);

                var currentSocketIoUserId = socket.request.session['user_id'];

                // if the recipient user id list is not part of the message
                // then define it anyways.
                if (msg.recipient_user_ids === undefined || msg.recipient_user_ids == null) {
                    msg.recipient_user_ids = [];
                }

                if (msg.recipient_user_ids.indexOf(currentSocketIoUserId) != -1) {
                    delete msg.recipient_user_ids; //don't include this with the message
                    socket.emit('realtime_msg', msg);
                }
            };

        });

        return io;
    },

    authorize: function authorize(io, redis) {
        io.use(function(socket, next) {
           
            var sessionId = null;
            var userId = null;

            var url = require('url');
            requestUrl = url.parse(socket.request.url);
            requestQuery = requestUrl.query;
            requestParams = requestQuery.split('&');
            params = {};
            for (i=0; i<=requestParams.length; i++){
                param = requestParams[i];
                if (param){
                    var p=param.split('=');
                    if (p.length != 2) { continue };
                    params[p[0]] = p[1];
                }
            }

            sessionId = params["_rtToken"];
            userId = params["_rtUserId"];
 
            // retrieve session from redis using the unique key stored in cookies
            redis.getSet.hget([("rtSession-" + userId), sessionId], 
                function(err, session) {
                    if (err || !session) {
                        next(new Error('Unauthorized Realtime user (session)'));
                    } else {
                        socket.request.session = JSON.parse(session);
                        next();
                    }
                }
            );
            
        });
    },

    loadRedis: function loadRedis() {
        var redis = require('redis');
        var url = require('url');
        var redisURL = url.parse("redis://127.0.0.1:6379/0");
        var redisSub, redisPub, redisGetSet = null;
        
        if (process.env.REDISCLOUD_URL == null) {
            // use local client if there's no redis cloud url set up.
            redisSub = redis.createClient();
            redisPub = redis.createClient();
            redisGetSet = redis.createClient();
        } else {
            // use environment redis connection info.
            redisURL = url.parse(process.env.REDISCLOUD_URL);
            redisSub = redis.createClient(redisURL.port, redisURL.hostname, {
                no_ready_check: true
            });
            redisPub = redis.createClient(redisURL.port, redisURL.hostname, {
                no_ready_check: true
            });
            redisGetSet = redis.createClient(redisURL.port, redisURL.hostname, {
                no_ready_check: true
            });
            redisSub.auth(redisURL.auth.split(":")[1]);
            redisPub.auth(redisURL.auth.split(":")[1]);
            redisGetSet.auth(redisURL.auth.split(":")[1]);
        }

        redisSub.subscribe('realtime_msg');

        return {
            pub: redisPub,
            sub: redisSub,
            getSet: redisGetSet,
        };
    },
}
