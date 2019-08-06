var CPUS = require('os').cpus();
var CPU = CPUS[0].model;
var CORES = CPUS.length;
process['UV_THREADPOOL_SIZE'] = CORES;

var Node = { crypto: require('crypto'), process: process };
var Queue = require('@ronomon/queue');
var ReedSolomon = require('./binding.node');

var MAX_K = Math.min(20, ReedSolomon.MAX_K);
var MAX_M = Math.min(4, ReedSolomon.MAX_M);
var SAMPLES = 40;
var SHARD_SIZES = [
  4096,
  65536,
  262144
];
var THREADS = 1;

function Display(columns) {
  columns[0] = String(columns[0]).padStart(10, ' ');
  columns[1] = String(columns[1]).padStart(10, ' ');
  columns[2] = String(columns[2]).padStart(10, ' ');
  columns[3] = String(columns[3]).padStart(10, ' ');
  columns[4] = String(columns[4]).padStart(14, ' ');
  console.log(columns.join(' | '));
}

function Divider() {
  console.log(new Array(66 + 1).join('-'));
}

var cipher = Node.crypto.createCipheriv(
  'AES-256-CTR',
  Buffer.alloc(32),
  Buffer.alloc(16)
);
var buffer = cipher.update(
  Buffer.alloc(
    (
      MAX_K * SHARD_SIZES[SHARD_SIZES.length - 1] +
      MAX_M * SHARD_SIZES[SHARD_SIZES.length - 1]
    ) * SAMPLES
  )
);
cipher.final();

console.log('');
console.log(('CPU | ').padStart(13, ' ') + CPU);
console.log(('CORES | ').padStart(13, ' ') + CORES);
console.log(('THREADS | ').padStart(13, ' ') + THREADS);
console.log('');
Divider();
Display([
  'DATA',
  'PARITY',
  'SHARD SIZE',
  'LATENCY',
  'THROUGHPUT'
]);

var queue = new Queue(1);
queue.onData = function(args, end) {
  var context = args.context;
  var k = args.k;
  var m = args.m;
  var shardSize = args.shardSize;
  if (shardSize === SHARD_SIZES[0]) Divider();
  var sources = 0;
  var targets = 0;
  for (var i = 0; i < k + m; i++) {
    if (i < k) {
      sources |= (1 << i);
    } else {
      targets |= (1 << i);
    }
  }
  var bufferOffset = 0;
  var samples = [];
  var length = SAMPLES;
  while (length--) {
    samples.push({
      sources: sources,
      targets: targets,
      buffer: buffer,
      bufferOffset: bufferOffset,
      bufferSize: shardSize * k,
      parity: buffer,
      parityOffset: bufferOffset += shardSize * k,
      paritySize: shardSize * m
    });
  }
  var queue = new Queue(THREADS);
  queue.onData = function(sample, end) {
    ReedSolomon.encode(
      context,
      sample.sources,
      sample.targets,
      sample.buffer,
      sample.bufferOffset,
      sample.bufferSize,
      sample.parity,
      sample.parityOffset,
      sample.paritySize,
      end
    );
  };
  queue.onEnd = function(error) {
    if (error) return end(error);
    var elapsed = Node.process.hrtime(hrtime);
    var ms = (elapsed[0] / 1000) + (elapsed[1] / 1000000);
    var latency = ms / samples.length;
    var bytes = shardSize * k * samples.length;
    var throughput = bytes / ms / 1000;
    Display([
      k,
      m,
      shardSize,
      latency.toFixed(3) + 'ms',
      throughput.toFixed(2) + ' MB/s'
    ]);
    end();
  };
  var hrtime = Node.process.hrtime();
  queue.concat(samples);
  queue.end();
};
queue.onEnd = function() {
  Divider();
};
for (var k = 1; k <= MAX_K; k++) {
  for (var m = 1; m <= MAX_M; m++) {
    var context = ReedSolomon.create(k, m);
    var shardSizesIndex = 0;
    var shardSizesLength = SHARD_SIZES.length;
    while (shardSizesIndex < shardSizesLength) {
      queue.push({
        context: context,
        k: k,
        m: m,
        shardSize: SHARD_SIZES[shardSizesIndex++]
      });
    }
  }
}
queue.end();
