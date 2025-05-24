const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const twilio = require('twilio');



const httpPORT = process.env.httpPORT || 5002;
const app = express();


const corsOptions = {
    origin: ["https://chatbox-qc5v.onrender.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};


app.use(cors(corsOptions));

// Create HTTP server
const httpServer = http.createServer(app);

let connectedUsers = [];
let rooms = [];

//initializs socket,io with https server and cors options
const io = require('socket.io')(httpServer, {
    cors: {
        origin: 'https://chatbox-qc5v.onrender.com',
        methods: ['GET', 'POST'],
        credentials: true
    },
    path: "/socket",
    wssEngine: ["ws", "wss"],
    transports: ['websocket', 'polling'],
    allowEIO3: true,
});

//create room to check if server exists

app.get('/api/room-exists/:roomId', (req, res) => {
    const {roomId} = req.params;
    const room = rooms.find((room) => room.id === roomId);

    if (room) {
        // send response that room exists
        if (room.connectedUsers.length > 3) {
            return res.send({roomExists: true, full: true});
        }  else {
            return res.send({ roomExists: true, full: false});
        }
    } else {
        // send response that room does not exist
        return res.send({roomExists: false });
    }
});




///////////////////////////////// TURN SERVERS //////////////////////////////

app.get('/api/get-turn-credentials', (req, res) => {
    const accountSid = 'AC31e6c6e5ad8185d5457447be2222abd3';
    const authToken = 'ee7513d5a7d13d9c399f3efef1995c41';

    const client = twilio(accountSid, authToken);

    //let responseToken = null;

    try {
        client.tokens.create().then(token => {
            //responseToken = token;
            res.send({token});
        });
    } catch (err) {
        console.log('error occured when fetching turn server credentials');
        console.log(err);
        res.send({token: null});
    }
});

// Handle Socket.io connections

io.on("connection", (socket) => {
    console.log(`user connected ${socket.id}`);


// Event for creating a new room
    socket.on('create-new-room', (data) => {
        createNewRoomHandler(data, socket);
       
    });

// Event for joining a room    
    socket.on('join-room', (data) => {
        joinRoomHandler(data, socket);
    });

// Event for disconnecting
    socket.on('disconnect', () => {
        disconnectHandler(socket);
    });

// Event for signaling
    socket.on('conn-signal', data => {
        signalingHandler(data, socket);
    });

// Event for initialising connection
    socket.on('conn-init', data => {
        initializeConnectionHandler(data, socket);
    });

    socket.on('direct-message', data => {
        directMessageHandler(data,socket);
    });
});

// socket.io handlers

const createNewRoomHandler = (data, socket) => {
    console.log('host is creating new room');
    console.log(data);
    const {identity, onlyAudio } = data;
    
    const roomId = uuidv4();

    // create new user
    const newUser = {
        identity,
        id: uuidv4(),
        socketId: socket.id,
        roomId,
        onlyAudio
    };

    //push that user to connected users
    connectedUsers = [...connectedUsers, newUser];

    // create new room
    const newRoom = {
        id: roomId,
        connectedUsers: [newUser],
    };
    //join socket.io room
    socket.join(roomId);

    rooms = [...rooms, newRoom];

    // emit to that client which created that roomId
    socket.emit('room-id', { roomId });

    // emit an event to all users connected
    // to that room about new users which are right now in this room
    socket.emit('room-update', {connectedUsers: newRoom.connectedUsers});
};

const joinRoomHandler = (data, socket) => {
    const {identity, roomId, onlyAudio} = data;

    const newUser = {
        identity,
        id: uuidv4(),
        socketId: socket.id,
        roomId,
        onlyAudio,
    };

    //join room as user which just trying to join room passing room id
    const room = rooms.find(room => room.id === roomId);
    room.connectedUsers = [...room.connectedUsers, newUser];

    // join socket.io room
    socket.join(roomId);

    //add new usser to connected users array
    connectedUsers = [...connectedUsers, newUser];

    // emit to all users which are already in this room to prepare peer connection
    room.connectedUsers.forEach(user => {
        if (user.socketId !== socket.id) {
            const data = {
                connUserSocketId : socket.id,
            };

            io.to(user.socketId).emit('conn-prepare', data);
        }
        
    });

    io.to(roomId).emit('room-update', {connectedUsers: room.connectedUsers});
};

const disconnectHandler = (socket) => {
    //find if user has been registered - if yes remove him from room and array
    const user = connectedUsers.find((user) => user.socketId === socket.id);

    if (user) {
        //remove user from room in server
        const room = rooms.find(room => room.id === user.roomId);

        room.connectedUsers = room.connectedUsers.filter(user => user.socketId !== socket.id);

        // leave socket io room
        socket.leave(user.roomId);

      
        //TODO
        //close the room if amount of users which will stay in room is 0
        if (room.connectedUsers.length > 0) {
            
            // emit to all users that user disconnected
            io.to(room.id).emit('user-disconnected', {socketId: socket.id});

              //emit an event to the rest of users which left in the room new connectedusers in room
        io.to(room.id).emit('room-update', {
            connectedUsers: room.connectedUsers,
        });
       } else {
        rooms = rooms.filter(r => r.id !== room.id);
       }

    }
};

const signalingHandler = (data, socket) => {
    const { connUserSocketId, signal } = data;

    const signalingData = {signal, connUserSocketId: socket.id};
    io.to(connUserSocketId).emit('conn-signal', signalingData);
};

//information from clients which are already in room that they have already prepared for incomin connection
const initializeConnectionHandler = (data, socket) => {
    const {connUserSocketId} = data;

    const initData = {connUserSocketId: socket.id};
    io.to(connUserSocketId).emit('conn-init', initData);
};

const directMessageHandler = (data, socket) => {
    if (connectedUsers.find(connUser => connUser.socketId === data.receiverSocketId)) {
        const receiverData = {
            authorSocketId: socket.id,
            messageContent: data.messageContent,
            isAuthor: false,
            identity: data.identity
        };
        socket.to(data.receiverSocketId).emit('direct-message', receiverData);

        const authorData = {
            receiverSocketId: data.receiverSocketId,
            messageContent: data.messageContent,
            isAuthor: true,
            identity: data.identity,
        };

        socket.emit('direct-message', authorData);
    }
};


httpServer.listen(httpPORT, () => {
    console.log(`Server is listening on ${httpPORT}`);
});



