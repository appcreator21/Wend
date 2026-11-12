#!/usr/bin/env ruby
# Regenerates Coil.xcodeproj. Only needed after adding or removing files; the project is committed.
#   gem install xcodeproj && ruby coil/tools/make-xcodeproj.rb
require 'xcodeproj'
require 'fileutils'

root = File.expand_path('..', __dir__)
path = File.join(root, 'Coil.xcodeproj')
FileUtils.rm_rf(path)
project = Xcodeproj::Project.new(path)
deployment = '16.4' # the page's CSS uses color-mix(), which needs iOS 16.2+

config_ref = project.new_file('Config.xcconfig')
project.build_configurations.each do |c|
  c.base_configuration_reference = config_ref
  c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = deployment
  c.build_settings['SWIFT_VERSION'] = '5.0'
  c.build_settings['MARKETING_VERSION'] = '1.7'
  c.build_settings['CURRENT_PROJECT_VERSION'] = '10'
end

app = project.new_target(:application, 'Coil', :ios, deployment, nil, :swift)
ext = project.new_target(:messages_extension, 'CoilMessages', :ios, deployment, nil, :swift)

# Nothing links explicitly: Swift's `import` pulls in UIKit, WebKit and Messages.
[app, ext].each { |t| t.frameworks_build_phase.clear }
project.frameworks_group.clear

shared = project.new_group('Shared', 'Shared')
app_group = project.new_group('App', 'App')
ext_group = project.new_group('MessagesExtension', 'MessagesExtension')
web = project.new_group('Web', 'Web')
game_data = project.new_group('GameData (from the web game)', '..')

host = shared.new_file('GameHost.swift')
app.add_file_references([app_group.new_file('AppDelegate.swift'), host])
ext.add_file_references([ext_group.new_file('MessagesViewController.swift'), host])
app_group.new_file('Info.plist')
ext_group.new_file('Info.plist')

# The game page and its scripts are copied flat into both bundles.
resources = %w[index.html coil.css coil.js].map { |f| web.new_file(f) } +
            %w[src/generator.js data/words.js data/puzzles.js].map { |f| game_data.new_file(f) }
app.add_resources(resources + [app_group.new_file('Assets.xcassets')])
ext.add_resources(resources + [ext_group.new_file('Assets.xcassets')])

common = {
  'CODE_SIGN_STYLE' => 'Automatic',
  'GENERATE_INFOPLIST_FILE' => 'NO',
  'TARGETED_DEVICE_FAMILY' => '1',
  'SWIFT_VERSION' => '5.0',
  'IPHONEOS_DEPLOYMENT_TARGET' => deployment,
  'MARKETING_VERSION' => '1.7',
  'CURRENT_PROJECT_VERSION' => '10',
}
app.build_configurations.each do |c|
  c.build_settings.delete('ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME')
  c.build_settings.merge!(common)
  c.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => '$(APP_BUNDLE_ID)',
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => 'App/Info.plist',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks'],
  )
end
ext.build_configurations.each do |c|
  c.build_settings.delete('ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME')
  c.build_settings.merge!(common)
  c.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => '$(APP_BUNDLE_ID).messages',
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => 'MessagesExtension/Info.plist',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'iMessage App Icon',
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
    'SKIP_INSTALL' => 'YES',
    'APPLICATION_EXTENSION_API_ONLY' => 'YES',
  )
end

# The app carries the iMessage extension inside it.
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(ext.product_reference).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.root_object.attributes['LastUpgradeCheck'] = '1600'
project.root_object.attributes['TargetAttributes'] = {
  app.uuid => { 'CreatedOnToolsVersion' => '16.0' },
  ext.uuid => { 'CreatedOnToolsVersion' => '16.0' },
}
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.set_launch_target(app)
scheme.save_as(path, 'Coil', true)
puts "wrote #{path}"
