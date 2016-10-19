var QueueStream = function(concurrent, onEnd) {
  var self = this;
  self.closed = false;
  self.eof = false;
  self.done = false;
  self.arrays = [];
  self.array = undefined;
  self.index = 0;
  self.pending = 0;
  self.running = 0;
  if (concurrent === true) {
    self.concurrent = 1000000;
  } else if (typeof concurrent == 'number') {
    if (Math.floor(concurrent) !== concurrent) {
      throw 'QueueStream: Bad concurrent argument: ' + concurrent;
    }
    self.concurrent = concurrent;
  } else {
    self.concurrent = 1;
  }
  self.processing = false;
  if (onEnd) self.onEnd = onEnd;
};

QueueStream.prototype.callback = function(error) {
  var self = this;
  if (self.closed) return;
  self.running--;
  if (error) {
    self.closed = true;
    self.onEnd(error);
  } else if (self.done) {
    self.closed = true;
    self.onEnd();
  } else if (self.eof && (self.pending + self.running) === 0) {
    self.closed = true;
    self.onEnd();
  } else if (!self.processing) {
    self.process();
  }
};

QueueStream.prototype.clear = function() {
  var self = this;
  self.arrays = [];
  self.array = undefined;
  self.index = 0;
  self.pending = 0;
};

QueueStream.prototype.end = function(error) {
  var self = this;
  if (self.closed) return;
  if (self.eof) return;
  self.eof = true;
  if (error || self.running === 0) {
    self.closed = true;
    self.onEnd(error);
  }
};

QueueStream.prototype.onData = function(data, end) { end(); };

QueueStream.prototype.onEnd = function(error) {};

QueueStream.prototype.process = function() {
  var self = this;
  if (self.processing) return;
  self.processing = true;
  function callback(error) { self.callback(error); }
  do {
    while (self.array && self.index < self.array.length) {
      if (self.closed || self.running >= self.concurrent) {
        return (self.processing = false);
      }
      self.pending--;
      self.running++;
      self.onData(self.array[self.index++], callback);
    }
    self.array = self.arrays.shift();
    self.index = 0;
  } while (self.array);
  self.processing = false;
};

QueueStream.prototype.push = function(data) {
  var self = this;
  if (self.closed) return;
  if (!data || data.constructor !== Array) {
    data = [data];
  } else if (data.length === 0) {
    return;
  }
  if (self.array) {
    self.arrays.push(data);
  } else {
    self.array = data;
  }
  self.pending += data.length;
  if (!self.processing) self.process();
};

module.exports = QueueStream;
