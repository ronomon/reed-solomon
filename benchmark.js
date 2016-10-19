var ram = 268435456;
var cpus = require('os').cpus();
var cpu = cpus[0].model;
var cores = cpus.length;
// Using more cores increases throughput.
// Using more than 1/2 available cores can increase latency.
var concurrency = Math.max(2, Math.round(cores / 2));
process['UV_THREADPOOL_SIZE'] = cores;

var QueueStream = require('./queue-stream.js');
var ReedSolomon = require('./index.js');

var Execute = {};

Execute.Encode = function(binding, vector, end) {
  binding.encode(
    vector.buffer,
    vector.bufferOffset,
    vector.bufferSize,
    vector.shardLength,
    vector.shardOffset,
    vector.shardSize,
    end
  );
};

Execute.Decode = function(binding, vector, end) {
  var targets = 0;
  targets |= (1 << 0);
  targets |= (1 << 1);
  targets |= (1 << (totalShards - 1));
  binding.decode(
    vector.buffer,
    vector.bufferOffset,
    vector.bufferSize,
    vector.shardLength,
    vector.shardOffset,
    vector.shardSize,
    targets,
    end
  );
};

var dataShards = 10;
var parityShards = 4;
var totalShards = 14;
var binding = {
  'Javascript': new ReedSolomon(
    dataShards,
    parityShards,
    ReedSolomon.binding.javascript
  ),
  'Native': new ReedSolomon(
    dataShards,
    parityShards,
    ReedSolomon.binding.native
  )
};

function benchmark(type, vectors, name, binding, end) {
  if (name == 'Native') {
    var queueConcurrency = concurrency;
  } else {
    var queueConcurrency = 1;
  }
  var now = Date.now();
  var sum = 0;
  var time = 0;
  var count = 0;
  var queue = new QueueStream(queueConcurrency);
  queue.onData = function(vector, end) {
    var hrtime = process.hrtime();
    Execute[type](binding, vector,
      function(error) {
        if (error) return end(error);
        var difference = process.hrtime(hrtime);
        var ns = (difference[0] * 1e9) + difference[1];
        // Count the number of data bytes that can be processed per second:
        sum += vector.shardLength * dataShards;
        time += ns;
        count++;
        end();
      }
    );
  };
  queue.onEnd = function(error) {
    if (error) return end(error);
    var elapsed = Date.now() - now;
    var latency = (time / count) / 1000000;
    var throughput = sum / elapsed / 1000;
    display([
      name + ':',
      'Latency:',
      latency.toFixed(3) + 'ms',
      'Throughput:',
      throughput.toFixed(2) + ' MB/s'
    ]);
    // Rest between benchmarks to leave room for GC:
    setTimeout(end, 100);
  };
  queue.push(vectors);
  queue.end();
}

function display(columns) {
  var string = columns[0];
  while (string.length < 15) string = ' ' + string;
  string += ' ' + columns.slice(1).join(' ');
  console.log(string);
}

console.log('');
display([ 'CPU:', cpu ]);
display([ 'Cores:', cores ]);
display([ 'Threads:', concurrency ]);

var queue = new QueueStream();
queue.onData = function(type, end) {
  console.log('');
  console.log('============================================================');
  var queue = new QueueStream();
  queue.onData = function(shardLength, end) {
    var vectors = [];
    var length = Math.min(10000, Math.round(ram / 2 / shardLength));
    console.log('');
    var parameters = [
      'Data=' + dataShards,
      'Parity=' + parityShards,
      'Shard=' + shardLength
    ];
    display([
      type + ':',
      length + ' x (' + parameters.join(' ') + ')'
    ]);
    while (length--) {
      vectors.push({
        buffer: Buffer.alloc(totalShards * shardLength),
        bufferOffset: 0,
        bufferSize: totalShards * shardLength,
        shardLength: shardLength,
        shardOffset: 0,
        shardSize: shardLength
      });
    }
    var queue = new QueueStream();
    queue.onData = function(name, end) {
      benchmark(type, vectors, name, binding[name], end);
    };
    queue.onEnd = end;
    queue.push([
      'Javascript',
      'Native'
    ]);
    queue.end();
  };
  queue.onEnd = end;
  queue.push([
    256,
    1024,
    4096,
    65536,
    131072,
    1048576
  ]);
  queue.end();
};
queue.onEnd = function(error) {
  if (error) throw error;
  console.log('');
};
queue.push([
  'Encode',
  'Decode'
]);
queue.end();
