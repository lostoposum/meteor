ResolverState = function (resolver) {
  var self = this;
  self._resolver = resolver;
  // The versions we've already chosen.
  // unitName -> UnitVersion
  self.choices = mori.hash_map();
  // Units we need, but haven't chosen yet.
  // unitName -> set(UnitVersions)
  self._dependencies = mori.hash_map();
  // Constraints that apply.
  self.constraints = new ConstraintSolver.ConstraintsList;
  // If we've already hit a contradiction.
  self.error = null;
};

_.extend(ResolverState.prototype, {
  addConstraint: function (constraint) {
    var self = this;
    if (self.error)
      return self;
    self = self._clone();

    self.constraints = self.constraints.push(constraint);

    var chosen = mori.get(self.choices, constraint.name);
    if (chosen && !constraint.isSatisfied(chosen, self._resolver)) {
      // This constraint conflicts with a choice we've already made!
      self.error = "conflict: " + constraint.toString() + " vs " +
        chosen.version;
      return self;
    }

    var alternatives = mori.get(self._dependencies, constraint.name);
    if (alternatives) {
      var newAlternatives = mori.set(mori.filter(function (unitVersion) {
        return constraint.isSatisfied(unitVersion, self._resolver);
      }, alternatives));
      if (mori.is_empty(newAlternatives)) {
        // XXX we should mention other constraints that are active
        self.error = "conflict: " + constraint.toString() +
          " cannot be satisfied";
      } else if (mori.count(newAlternatives) === 1) {
        // There's only one choice, so we can immediately choose it.
        self = self.addChoice(mori.first(newAlternatives));
      } else if (mori.count(newAlternatives) !== mori.count(alternatives)) {
        self._dependencies = mori.assoc(
          self._dependencies, constraint.name, newAlternatives);
      }
    }
    return self;
  },
  addDependency: function (unitName) {
    var self = this;

    if (self.error || mori.has_key(self.choices, unitName)
        || mori.has_key(self._dependencies, unitName)) {
      return self;
    }

    self = self._clone();

    if (!_.has(self._resolver.unitsVersions, unitName)) {
      self.error = "unknown package: " + unitName;
      return self;
    }

    var alternatives = mori.set();
    _.each(self._resolver.unitsVersions[unitName], function (uv) {
      if (self.constraints.isSatisfied(uv, self._resolver)) {
        // XXX hang on to list of violated constraints and use it in error
        // message
        alternatives = mori.conj(alternatives, uv);
      }
    });

    if (mori.is_empty(alternatives)) {
      // XXX mention constraints or something
      self.error = "conflict: " + unitName + " can't be satisfied";
      return self;
    } else if (mori.count(alternatives) === 1) {
      // There's only one choice, so we can immediately choose it.
      self = self.addChoice(mori.first(alternatives));
    } else {
      self._dependencies = mori.assoc(
        self._dependencies, unitName, alternatives);
    }

    return self;
  },
  addChoice: function (uv) {
    var self = this;

    if (self.error)
      return self;
    if (mori.has_key(self.choices, uv.name))
      throw Error("Already chose " + uv.name);

    self = self._clone();

    // Does adding this choice break some constraints we already have?
    if (!self.constraints.isSatisfied(uv, self._resolver)) {
      // XXX improve error
      self.error = "conflict: " + uv.toString() + " can't be chosen";
      return self;
    }

    // Great, move it from dependencies to choices.
    self.choices = mori.assoc(self.choices, uv.name, uv);
    self._dependencies = mori.dissoc(self._dependencies, uv.name);

    // Since we're committing to this version, we're committing to all it
    // implies.
    uv.constraints.each(function (constraint) {
      self = self.addConstraint(constraint);
    });
    _.each(uv.dependencies, function (unitName) {
      self = self.addDependency(unitName);
    });

    return self;
  },
  success: function () {
    var self = this;
    return !self.error && mori.is_empty(self._dependencies);
  },
  eachDependency: function (iter) {
    var self = this;
    mori.some(function (nameAndAlternatives) {
      return BREAK == iter(mori.first(nameAndAlternatives),
                           mori.last(nameAndAlternatives));
    }, self._dependencies);
  },
  _clone: function () {
    var self = this;
    var clone = new ResolverState(self._resolver);
    _.each(['choices', '_dependencies', 'constraints', 'error'], function (field) {
      clone[field] = self[field];
    });
    return clone;
  }
});