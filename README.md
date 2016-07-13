# reed-solomon
Reed-Solomon erasure coding in pure Javascript. A Javascript port of the [JavaReedSolomon](https://github.com/Backblaze/JavaReedSolomon) library released by [Backblaze](http://backblaze.com). For an introduction to erasure coding, see the post by Brian Beach on the [Backblaze blog](https://www.backblaze.com/blog/reed-solomon/). Special thanks to [Backblaze](http://backblaze.com).

## License
`reed-solomon` is licensed under the [MIT License](https://en.wikipedia.org/wiki/MIT_License), which means that you can use it in your own projects for free. You can even use it in commercial projects.

## Installation
```
npm install reed-solomon
```

## Efficiency
Data redundancy is typically achieved through mirroring or replication at a cost of 3x the original data. With Reed-Solomon erasure codes, you can achieve better redundancy at a cost of only 1.5x the original data, for example. Various storage efficiencies of 1.4x and 1.18x are also possible. You can trade storage efficiency, redundancy and recovery time by fine-tuning the number of data shards and parity shards you use.

## Performance
`reed-solomon` includes a Javascript binding as well as an optional native binding (and simple benchmark):
```
ReedSolomon(17, 3)

1,8 GHz Intel Core i5

Binding: Native

Encode: 400.00 MB/s
Decode: 369.57 MB/s

Binding: Javascript

Encode: 195.68 MB/s
Decode: 193.18 MB/s
```

## Optional Native Binding
The native binding will be installed by default when installing `reed-solomon`, and the Javascript binding will be used if the native binding could not be compiled. To compile the native binding manually, install [node-gyp](https://www.npmjs.com/package/node-gyp) globally:
```
sudo npm install node-gyp -g
```
Then build the binding from within the `reed-solomon` module directory:
```
cd node_modules/reed-solomon
node-gyp rebuild
```

## Usage
Divide a single `Buffer` into an `Array` of fixed-size data shards, then use `reed-solomon` to compute as many parity shards as you need. If you lose some data shards or some parity shards (no more than the number of parity shards you added), you can use `reed-solomon` to reconstruct the missing data and parity shards.

#### Encoding
```
var ReedSolomon = require('reed-solomon');
var dataShards = 6;
var parityShards = 3;
var shardSize = 1024 * 1024;
var shards = [
  // Data shards (containing user data):
  <Buffer (shardSize) >,
  <Buffer (shardSize) >,
  <Buffer (shardSize) >,
  <Buffer (shardSize) >,
  <Buffer (shardSize) >,
  <Buffer (shardSize) >,
  // Parity shards:
  new Buffer(shardSize),
  new Buffer(shardSize),
  new Buffer(shardSize)
];
var rs = new ReedSolomon(dataShards, parityShards);
var offset = 0; // The offset of each shard within each buffer.
var size = shardSize; // The size of each shard within each buffer.
rs.encode(shards, offset, size);
// Parity shards now contain parity data.
```
#### Verifying Parity Shards
```
rs.isParityCorrect(shards, offset, size); // true/false
```
#### Decoding Corrupted Shards
```
// Corrupt a data shard:
shards[0] = new Buffer(shardSize);
// Corrupt a parity shard:
shards[shards.length - 1] = new Buffer(shardSize);
// We still have enough parity to corrupt another shard.

// Decode the corrupted data and parity shards:
var present = [
  false, // We indicate that shard 1/9 is corrupt. This is a data shard.
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  false // We indicate that shard 9/9 is corrupt. This is a parity shard.
];
rs.decode(shards, offset, size, present);
// Shards 1 and 9 have been repaired.
```

## Tests
`reed-solomon` ships with extensive tests, including a long-running fuzz test.
```
cd node-modules/reed-solomon
node test.js
```
