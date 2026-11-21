package a

class SharedPrefs {
  private val safeInstance = openPrefs()

  fun getString(key: String): String? {
    return safeInstance.getString(key, null)
  }
}
