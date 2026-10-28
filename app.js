'use strict';

const express = require('express');
const server = require('./Server/server');
const app = express();
if(process.env.VERCEL==='1')app.set('trust proxy',1);
app.use(server);
module.exports = app;
