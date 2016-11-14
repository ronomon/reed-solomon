# reed-solomon
Reed-Solomon erasure coding in pure Javascript with an optional C++ binding for multi-core throughput. A port of the [JavaReedSolomon](https://github.com/Backblaze/JavaReedSolomon) library released by [Backblaze](http://backblaze.com). For an introduction to erasure coding, see the post by Brian Beach on the [Backblaze blog](https://www.backblaze.com/blog/reed-solomon/). Special thanks to [Backblaze](http://backblaze.com).

## License
`reed-solomon` is licensed under the [MIT License](https://en.wikipedia.org/wiki/MIT_License), which means that you can use it in your own projects for free. You can even use it in commercial projects.

## Installation

#### Linux, OS X
This will compile the native binding automatically:
```
npm install reed-solomon
```

#### Windows
This will skip compiling the native binding automatically:
```
npm install --ignore-scripts reed-solomon
```

## Efficiency
Data redundancy is typically achieved through mirroring or replication at a cost of 3x the original data. With Reed-Solomon erasure codes, you can achieve better redundancy at a cost of only 1.5x the original data. Various storage efficiencies of 1.4x and 1.18x are also possible. You can trade storage efficiency, redundancy and recovery time by fine-tuning the number of data shards and parity shards you use.

## Performance
`reed-solomon` includes a Javascript binding as well as an optional native binding. The native binding executes asynchronously in Node's threadpool for multi-core throughput and scalability without blocking the event loop:
```
           CPU: Intel(R) Xeon(R) CPU E3-1230 V2 @ 3.30GHz
         Cores: 8
       Threads: 4

============================================================

        Encode: 10000 x (Data=10 Parity=4 Shard=256)
    Javascript: Latency: 0.028ms Throughput: 88.89 MB/s
        Native: Latency: 0.044ms Throughput: 224.56 MB/s

        Encode: 10000 x (Data=10 Parity=4 Shard=1024)
    Javascript: Latency: 0.064ms Throughput: 159.75 MB/s
        Native: Latency: 0.054ms Throughput: 747.45 MB/s

        Encode: 10000 x (Data=10 Parity=4 Shard=4096)
    Javascript: Latency: 0.207ms Throughput: 197.02 MB/s
        Native: Latency: 0.124ms Throughput: 1312.82 MB/s

        Encode: 2048 x (Data=10 Parity=4 Shard=65536)
    Javascript: Latency: 3.099ms Throughput: 211.43 MB/s
        Native: Latency: 1.637ms Throughput: 1597.83 MB/s

        Encode: 1024 x (Data=10 Parity=4 Shard=131072)
    Javascript: Latency: 6.202ms Throughput: 211.27 MB/s
        Native: Latency: 3.357ms Throughput: 1558.86 MB/s

        Encode: 128 x (Data=10 Parity=4 Shard=1048576)
    Javascript: Latency: 51.338ms Throughput: 204.23 MB/s
        Native: Latency: 26.021ms Throughput: 1595.93 MB/s

============================================================

        Decode: 10000 x (Data=10 Parity=4 Shard=256)
    Javascript: Latency: 0.068ms Throughput: 37.10 MB/s
        Native: Latency: 0.246ms Throughput: 41.36 MB/s

        Decode: 10000 x (Data=10 Parity=4 Shard=1024)
    Javascript: Latency: 0.095ms Throughput: 107.56 MB/s
        Native: Latency: 0.271ms Throughput: 150.59 MB/s

        Decode: 10000 x (Data=10 Parity=4 Shard=4096)
    Javascript: Latency: 0.196ms Throughput: 208.13 MB/s
        Native: Latency: 0.264ms Throughput: 618.73 MB/s

        Decode: 2048 x (Data=10 Parity=4 Shard=65536)
    Javascript: Latency: 2.390ms Throughput: 274.03 MB/s
        Native: Latency: 1.397ms Throughput: 1871.93 MB/s

        Decode: 1024 x (Data=10 Parity=4 Shard=131072)
    Javascript: Latency: 4.656ms Throughput: 281.32 MB/s
        Native: Latency: 2.683ms Throughput: 1950.84 MB/s

        Decode: 128 x (Data=10 Parity=4 Shard=1048576)
    Javascript: Latency: 36.400ms Throughput: 288.02 MB/s
        Native: Latency: 24.051ms Throughput: 1711.96 MB/s
```

## Native Binding (Optional)
The native binding will be installed automatically when installing `reed-solomon` without the `--ignore-scripts` argument. The Javascript binding will be used if the native binding could not be compiled or is not available. To compile the native binding manually after installing `reed-solomon`, install [node-gyp](https://www.npmjs.com/package/node-gyp) globally:
```
sudo npm install node-gyp -g
```
Then build the binding from within the `reed-solomon` module directory:
```
cd node_modules/reed-solomon
node-gyp rebuild
```

## Usage

#### Adjust threadpool size and control concurrency
Please see the [`crypto-async`](https://github.com/jorangreef/crypto-async#adjust-threadpool-size-and-control-concurrency) module for advice on adjusting threadpool size and controlling concurrency.

#### Encoding Parity Shards
```
var ReedSolomon = require('reed-solomon');

// Specify the number of data shards (<=30):
var dataShards = 6;

// Specify the number of parity shards (<=30):
var parityShards = 3; // Protect against loss of any 3 data or parity shards.

// The total number of shards must be at most 31:
var totalShards = dataShards + parityShards;

// Specify the total length of each shard in bytes:
var shardLength = 1024 * 1024;

var buffer = Buffer.concat([
  // Non-ReedSolomon header data:
  <Buffer (16)>,
  // Data shards:
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  // Parity shards:
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  <Buffer (shardLength)>,
  // Non-ReedSolomon footer data:
  <Buffer (...)>
]);

// Specify the offset into the buffer at which shards begin:
// This allows you to include non-ReedSolomon header data in the buffer.
var bufferOffset = 16;

// Specify the size after this offset of all shards:
// This allows you to include non-ReedSolomon footer data in the buffer.
var bufferSize = shardLength * totalShards;

// Specify the offset into each shard from which to encode/decode:
// This allows you to include non-ReedSolomon header data in each shard.
var shardOffset = 0;

// Specify the size after this offset:
// This allows you to include non-ReedSolomon footer data in each shard.
var shardSize = shardLength - shardOffset;

// Instantiate a ReedSolomon instance:
// This can be used concurrently across many `encode()`/`decode()` calls.
var rs = new ReedSolomon(dataShards, parityShards);

// Encode all parity shards:
rs.encode(
  buffer,
  bufferOffset,
  bufferSize,
  shardLength,
  shardOffset,
  shardSize,
  function(error) {
    if (error) throw error;
    // Parity shards now contain parity data.
  }
);
```

#### Decoding Corrupted Shards
```
// Corrupt a data shard:
buffer[0] = 255;
// Corrupt a parity shard:
buffer[dataShards + parityShards - 1] = 255;
// We still have enough parity to corrupt another shard.

// Specify each corrupted shard according to its index in the array:
// If a corrupted shard is not specified, the result will be wrong.
var targets = 0;
targets |= (1 << 0); // Data shard at index 0 needs to be decoded.
targets |= (1 << 8); // Parity shard at index 8 needs to be decoded.

// Decode the corrupted data and parity shards:
rs.decode(
  buffer,
  bufferOffset,
  bufferSize,
  shardLength,
  shardOffset,
  shardSize,
  targets,
  function(error) {
    if (error) throw error;
    // Data shard at index 0 has been repaired.
    // Parity shard at index 8 has been repaired.
  }
);
```

## Tests
`reed-solomon` ships with extensive tests, including a long-running fuzz test.

To test the native and Javascript bindings:
```
node test.js
```

## Benchmark
To benchmark the native and Javascript bindings:
```
node benchmark.js
```
