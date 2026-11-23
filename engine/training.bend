import Base

def to_flag(ok: Bool) -> U32:
  match ok:
    case True{}:
      1
    case False{}:
      0

def includes(+value: U32, +lower: U32, +upper: U32) -> U32:
  to_flag((value >= lower : U32) && (value <= upper : U32))

def choose(ok: Bool, yes: U32, no: U32) -> U32:
  match ok:
    case True{}:
      yes
    case False{}:
      no

def distance(+value: U32, +target: U32) -> U32:
  choose((value >= target : U32), (value - target : U32), (target - value : U32))

# Pick the smallest next virtual finish time without floating point.
def precedes(+served: U32, +weight: U32, +other_served: U32, +other_weight: U32) -> U32:
  a = (served + 1 : U32)
  b = (other_served + 1 : U32)
  left = (a * other_weight : U32)
  right = (b * weight : U32)
  to_flag((left < right : U32))

def first_accept(+current: U32, +candidate: U32) -> U32:
  choose((candidate < current : U32), candidate, current)

def contribution(+day: U32, +start: U32, +end: U32, +count: U32) -> U32:
  (includes(day, start, end) * count : U32)
