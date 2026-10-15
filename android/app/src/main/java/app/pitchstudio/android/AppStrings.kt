package app.pitchstudio.android

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import androidx.compose.runtime.staticCompositionLocalOf
import app.pitchstudio.core.View
import java.util.Locale

enum class Language(val code: String) {
    ENGLISH("en"), CHINESE("zh-CN");
    companion object { fun fromCode(code: String?) = entries.firstOrNull { it.code == code } ?: ENGLISH }
}

val LocalAppStrings = staticCompositionLocalOf<AppStrings> { error("AppStrings provider is missing") }

/** Resources with an explicit locale, without recreating the recording Activity. */
class AppStrings(context: Context, val language: Language) {
    private val resources: Resources = context.createConfigurationContext(
        Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag(language.code)) }
    ).resources
    fun get(id: Int, vararg args: Any): String =
        if (args.isEmpty()) resources.getString(id) else resources.getString(id, *args)
    fun setting(value: Boolean?) = get(when (value) {
        true -> R.string.on
        false -> R.string.off
        null -> R.string.unknown
    })
    fun viewName(view: View) = get(when (view) {
        View.PITCH -> R.string.pitch
        View.SPECTROGRAM -> R.string.spectrogram
        View.WAVEFORM -> R.string.waveform
        View.SPECTRUM -> R.string.spectrum
    })

    /** Only app-generated diagnostics use this adapter, never user or device names. */
    fun message(value: String): String = message(value, 0)
    private fun message(value: String, depth: Int): String {
        if (language == Language.ENGLISH || depth > 8) return value
        exactMessages[value]?.let { return get(it) }
        for (entry in patterns) {
            val match = entry.regex.matchEntire(value) ?: continue
            val args = match.groupValues.drop(1).mapIndexed<String, Any> { index, argument ->
                if (entry.numeric[index]) argument.toDoubleOrNull() ?: return value
                else message(argument, depth + 1)
            }.toTypedArray()
            return get(entry.id, *args)
        }
        return value
    }
    fun probe(value: String) = value.split(" · ").joinToString(" · ") { message(it) }

    private data class Pattern(val regex: Regex, val id: Int, val numeric: List<Boolean>)
    companion object {
        private val token = Regex("\\{\\d+\\}|%[+]?\\.\\d+f")
        private val exactMessages = messageCatalog.filter { !token.containsMatchIn(it.first) }.toMap()
        private val patterns = messageCatalog.filter { token.containsMatchIn(it.first) }.map { (template, id) ->
            val numeric = mutableListOf<Boolean>()
            var end = 0
            val pattern = buildString {
                for (match in token.findAll(template)) {
                    append(Regex.escape(template.substring(end, match.range.first)))
                    append("([\\s\\S]*?)")
                    numeric += match.value.startsWith('%')
                    end = match.range.last + 1
                }
                append(Regex.escape(template.substring(end)))
            }
            Pattern(Regex(pattern), id, numeric)
        }
    }
}
